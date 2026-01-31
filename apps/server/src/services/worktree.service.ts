import { simpleGit } from 'simple-git';
import { existsSync } from 'fs';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { randomUUID, createHash } from 'crypto';
import { projectService } from './project.service.js';
import { daemonClient } from '../pty/daemon-client.js';

export interface Worktree {
  id: string;
  projectId: string;
  path: string;
  branch: string;
  isMain: boolean;
  merged: boolean;
  archived: boolean;
  status: WorktreeStatus;
}

export interface WorktreeStatus {
  ahead: number;
  behind: number;
  modified: number;
  staged: number;
  untracked: number;
}

class WorktreeService {
  private worktrees = new Map<string, Worktree>();
  private archivedWorktrees = new Set<string>(); // worktree IDs that are archived

  // Load archived worktrees from project-local storage
  private async loadArchivedWorktrees(projectPath: string): Promise<Set<string>> {
    const archivePath = join(projectPath, '.orchard', 'archived-worktrees.json');
    if (!existsSync(archivePath)) {
      return new Set();
    }
    try {
      const data = await readFile(archivePath, 'utf-8');
      const archived: string[] = JSON.parse(data);
      return new Set(archived);
    } catch {
      return new Set();
    }
  }

  // Save archived worktrees to project-local storage
  private async saveArchivedWorktrees(projectPath: string): Promise<void> {
    const orchardDir = join(projectPath, '.orchard');
    if (!existsSync(orchardDir)) {
      await mkdir(orchardDir, { recursive: true });
    }
    const archivePath = join(orchardDir, 'archived-worktrees.json');
    const archived = Array.from(this.archivedWorktrees);
    await writeFile(archivePath, JSON.stringify(archived, null, 2));
  }

  async getDefaultBranch(projectId: string): Promise<string> {
    const mainPath = projectService.getMainWorktreePath(projectId);
    if (!mainPath) return 'main';

    const git = simpleGit(mainPath);

    try {
      // Try to get the default branch from remote
      const remotes = await git.remote(['show', 'origin']);
      if (remotes) {
        const match = remotes.match(/HEAD branch: (\S+)/);
        if (match) return match[1];
      }
    } catch {
      // Fallback: check which branch exists locally
    }

    try {
      const branches = await git.branchLocal();
      // Check common default branch names
      if (branches.all.includes('main')) return 'main';
      if (branches.all.includes('master')) return 'master';
      // Return current branch or first branch
      return branches.current || branches.all[0] || 'main';
    } catch {
      return 'main';
    }
  }

  async loadWorktreesForProject(projectId: string): Promise<Worktree[]> {
    const project = projectService.getProject(projectId);
    if (!project) return [];

    const mainPath = projectService.getMainWorktreePath(projectId);
    if (!mainPath || !existsSync(mainPath)) return [];

    // Load archived worktrees from persistent storage
    const archivedSet = await this.loadArchivedWorktrees(project.path);
    // Merge with in-memory set
    for (const id of archivedSet) {
      this.archivedWorktrees.add(id);
    }

    const git = simpleGit(mainPath);

    try {
      // Get worktree list
      const result = await git.raw(['worktree', 'list', '--porcelain']);
      const worktreeBlocks = result.split('\n\n').filter(Boolean);

      const worktrees: Worktree[] = [];

      for (const block of worktreeBlocks) {
        const lines = block.split('\n');
        let path = '';
        let branch = '';

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            path = line.replace('worktree ', '');
          } else if (line.startsWith('branch ')) {
            branch = line.replace('branch refs/heads/', '');
          }
        }

        if (path) {
          // For in-place projects, the project root is the main worktree
          // For cloned projects, the /main subdirectory is the main worktree
          const isMain = path === mainPath;
          const id = this.getOrCreateId(projectId, path);

          const status = await this.getWorktreeStatus(path);
          const archived = this.archivedWorktrees.has(id);

          // Merged detection disabled - the previous logic incorrectly marked new branches
          // from master as merged (since they are ancestors of master)
          const merged = false;

          const worktree: Worktree = {
            id,
            projectId,
            path,
            branch: branch || 'detached',
            isMain,
            merged,
            archived,
            status,
          };

          worktrees.push(worktree);
          this.worktrees.set(id, worktree);
        }
      }

      return worktrees;
    } catch (err) {
      console.error('Error loading worktrees:', err);
      return [];
    }
  }

  async createWorktree(
    projectId: string,
    branch: string,
    options?: { newBranch?: boolean; baseBranch?: string }
  ): Promise<Worktree> {
    const project = projectService.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const mainPath = projectService.getMainWorktreePath(projectId);
    if (!mainPath) {
      throw new Error('Could not find main worktree');
    }

    // For in-place projects, create worktrees in .worktrees/ subdirectory
    // For cloned projects, create them inside the project directory
    const worktreePath = project.inPlace
      ? join(project.path, '.worktrees', branch.replace(/\//g, '-'))
      : join(project.path, branch);

    if (existsSync(worktreePath)) {
      throw new Error(`Worktree path already exists: ${worktreePath}`);
    }

    const git = simpleGit(mainPath);

    if (options?.newBranch) {
      // Create new branch and worktree
      const base = options.baseBranch || 'HEAD';
      await git.raw(['worktree', 'add', '-b', branch, worktreePath, base]);
    } else {
      // Create worktree for existing branch
      await git.raw(['worktree', 'add', worktreePath, branch]);
    }

    const id = this.getOrCreateId(projectId, worktreePath);
    const status = await this.getWorktreeStatus(worktreePath);

    // Set up Claude permissions for this worktree
    await this.setupClaudePermissions(worktreePath, project.path);

    const worktree: Worktree = {
      id,
      projectId,
      path: worktreePath,
      branch,
      isMain: false,
      merged: false,
      archived: false,
      status,
    };

    this.worktrees.set(id, worktree);
    return worktree;
  }

  // Set up Claude permissions for a worktree to allow access to project and worktree folders
  private async setupClaudePermissions(worktreePath: string, projectPath: string): Promise<void> {
    const claudeDir = join(worktreePath, '.claude');
    const settingsPath = join(claudeDir, 'settings.local.json');

    try {
      if (!existsSync(claudeDir)) {
        await mkdir(claudeDir, { recursive: true });
      }

      // Include both project path and worktree path (they may differ for in-place projects)
      const allowedPaths = [projectPath];
      if (worktreePath !== projectPath && !worktreePath.startsWith(projectPath)) {
        allowedPaths.push(worktreePath);
      }

      const allowRules: string[] = [];
      for (const path of allowedPaths) {
        allowRules.push(`Bash(${path}/**)`);
        allowRules.push(`Read(${path}/**)`);
        allowRules.push(`Write(${path}/**)`);
        allowRules.push(`Edit(${path}/**)`);
      }

      const settings = {
        trust: true,
        permissions: {
          allow: allowRules,
          deny: []
        }
      };

      await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    } catch (err) {
      console.error('Error setting up Claude permissions:', err);
    }
  }

  async deleteWorktree(worktreeId: string, force = false): Promise<boolean> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) return false;

    if (worktree.isMain) {
      throw new Error('Cannot delete main worktree');
    }

    const project = projectService.getProject(worktree.projectId);
    if (!project) return false;

    const mainPath = projectService.getMainWorktreePath(worktree.projectId);
    if (!mainPath) return false;

    const git = simpleGit(mainPath);

    try {
      const args = ['worktree', 'remove', worktree.path];
      if (force) args.push('--force');
      await git.raw(args);
      this.worktrees.delete(worktreeId);
      return true;
    } catch (err) {
      console.error('Error deleting worktree:', err);
      return false;
    }
  }

  async getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus> {
    if (!existsSync(worktreePath)) {
      return { ahead: 0, behind: 0, modified: 0, staged: 0, untracked: 0 };
    }

    const git = simpleGit(worktreePath);

    try {
      const status = await git.status();

      return {
        ahead: status.ahead,
        behind: status.behind,
        modified: status.modified.length,
        staged: status.staged.length,
        untracked: status.not_added.length,
      };
    } catch {
      return { ahead: 0, behind: 0, modified: 0, staged: 0, untracked: 0 };
    }
  }

  async getBranches(projectId: string): Promise<{ local: string[]; remote: string[]; defaultBranch: string }> {
    const mainPath = projectService.getMainWorktreePath(projectId);
    if (!mainPath) return { local: [], remote: [], defaultBranch: 'main' };

    const git = simpleGit(mainPath);
    const defaultBranch = await this.getDefaultBranch(projectId);

    try {
      const branches = await git.branch(['-a']);
      const local = branches.all.filter(b => !b.startsWith('remotes/'));
      const remote = branches.all
        .filter(b => b.startsWith('remotes/origin/'))
        .map(b => b.replace('remotes/origin/', ''));

      return { local, remote, defaultBranch };
    } catch {
      return { local: [], remote: [], defaultBranch };
    }
  }

  getWorktree(worktreeId: string): Worktree | undefined {
    return this.worktrees.get(worktreeId);
  }

  getWorktreesForProject(projectId: string): Worktree[] {
    return Array.from(this.worktrees.values()).filter(w => w.projectId === projectId);
  }

  // Check if a branch has been fully merged into the default branch
  async checkIfMerged(projectId: string, branch: string): Promise<boolean> {
    const mainPath = projectService.getMainWorktreePath(projectId);
    if (!mainPath) return false;

    const git = simpleGit(mainPath);
    const defaultBranch = await this.getDefaultBranch(projectId);

    // Don't check main branch against itself
    if (branch === defaultBranch) return false;

    try {
      // Check if the branch is an ancestor of the default branch
      // This means all commits in branch exist in defaultBranch
      await git.raw(['merge-base', '--is-ancestor', branch, defaultBranch]);
      return true; // Exit code 0 means branch is merged
    } catch {
      return false; // Exit code 1 means not merged
    }
  }

  // Check if a worktree has active terminal sessions (means someone is working on it)
  async hasActiveTerminalSessions(worktreeId: string): Promise<boolean> {
    if (!daemonClient.isConnected()) return false;
    try {
      const sessions = await daemonClient.listSessions();
      return sessions.some((s: any) => s.worktreeId === worktreeId);
    } catch {
      return false;
    }
  }

  // Mark worktree as having new activity (un-archive it)
  markWorktreeActive(worktreeId: string): Worktree | undefined {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) return undefined;

    worktree.merged = false;
    worktree.archived = false;
    this.archivedWorktrees.delete(worktreeId);
    this.worktrees.set(worktreeId, worktree);

    // Save to persistent storage
    const project = projectService.getProject(worktree.projectId);
    if (project) {
      this.saveArchivedWorktrees(project.path).catch(console.error);
    }

    return worktree;
  }

  // Archive a worktree (mark as archived, sessions should be closed by caller)
  async archiveWorktree(worktreeId: string): Promise<Worktree | undefined> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree || worktree.isMain) return undefined;

    worktree.archived = true;
    this.archivedWorktrees.add(worktreeId);
    this.worktrees.set(worktreeId, worktree);

    // Save to persistent storage
    const project = projectService.getProject(worktree.projectId);
    if (project) {
      await this.saveArchivedWorktrees(project.path);
    }

    return worktree;
  }

  // Get merged but not archived worktrees (candidates for auto-archive)
  getMergedNotArchivedWorktrees(projectId: string): Worktree[] {
    return this.getWorktreesForProject(projectId)
      .filter(w => w.merged && !w.archived && !w.isMain);
  }

  // Generate deterministic ID based on path so it survives restarts
  private getOrCreateId(projectId: string, path: string): string {
    // Use a hash of projectId + path to create a deterministic UUID-like ID
    const hash = createHash('sha256').update(`${projectId}:${path}`).digest('hex');
    // Format as UUID: 8-4-4-4-12
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }
}

export const worktreeService = new WorktreeService();
