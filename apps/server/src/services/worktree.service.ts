import { simpleGit } from 'simple-git';
import { existsSync } from 'fs';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, basename, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHash } from 'crypto';
import { projectService } from './project.service.js';
import { daemonClient } from '../pty/daemon-client.js';
import { databaseService } from './database.service.js';

export type AgentMode = 'normal' | 'plan';

export interface Worktree {
  id: string;
  projectId: string;
  path: string;
  branch: string;
  isMain: boolean;
  merged: boolean;
  archived: boolean;
  mode?: AgentMode;       // Agent execution mode (normal or plan)
  status: WorktreeStatus;
  lastCommitDate: string | null;  // ISO date string of the most recent commit
  createdAt: string | null;       // ISO date string when worktree was created (first commit on branch)
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
  private worktreeModes = new Map<string, AgentMode>(); // worktree ID -> mode

  // Load archived worktrees from SQLite, migrating from JSON if needed
  private async loadArchivedWorktrees(projectPath: string, projectId: string): Promise<Set<string>> {
    // Check for JSON file and migrate to SQLite if it exists
    const archivePath = join(projectPath, '.orchard', 'archived-worktrees.json');
    if (existsSync(archivePath)) {
      try {
        const data = await readFile(archivePath, 'utf-8');
        const archived: string[] = JSON.parse(data);
        console.log(`[WorktreeService] Migrating ${archived.length} archived worktrees from JSON to SQLite`);
        // Note: We can't insert directly here because the worktree record needs to exist first
        // The archived IDs are stored in memory and will be persisted when loadWorktreesForProject syncs
        // Delete the JSON file after migration
        const { unlink } = await import('fs/promises');
        await unlink(archivePath);
        console.log(`[WorktreeService] Deleted ${archivePath} after migration`);
        return new Set(archived);
      } catch (err) {
        console.error('[WorktreeService] Error migrating archived worktrees:', err);
      }
    }

    // Load from SQLite
    const archivedIds = databaseService.getArchivedWorktreeIds(projectPath, projectId);
    return new Set(archivedIds);
  }

  // Save archived status to SQLite
  private async saveArchivedWorktree(projectPath: string, worktreeId: string, archived: boolean): Promise<void> {
    databaseService.setWorktreeArchived(projectPath, worktreeId, archived);
  }

  // Load worktree modes from SQLite, migrating from JSON if needed
  private async loadWorktreeModes(projectPath: string, projectId: string): Promise<Map<string, AgentMode>> {
    // Check for JSON file and migrate to SQLite if it exists
    const modesPath = join(projectPath, '.orchard', 'worktree-modes.json');
    if (existsSync(modesPath)) {
      try {
        const data = await readFile(modesPath, 'utf-8');
        const modesObj: Record<string, AgentMode> = JSON.parse(data);
        console.log(`[WorktreeService] Migrating ${Object.keys(modesObj).length} worktree modes from JSON to SQLite`);
        // Delete the JSON file after migration
        const { unlink } = await import('fs/promises');
        await unlink(modesPath);
        console.log(`[WorktreeService] Deleted ${modesPath} after migration`);
        return new Map(Object.entries(modesObj));
      } catch (err) {
        console.error('[WorktreeService] Error migrating worktree modes:', err);
      }
    }

    // Load from SQLite
    const records = databaseService.getWorktreeRecords(projectPath, projectId);
    const modes = new Map<string, AgentMode>();
    for (const record of records) {
      if (record.mode) {
        modes.set(record.id, record.mode as AgentMode);
      }
    }
    return modes;
  }

  // Save worktree mode to SQLite
  private async saveWorktreeMode(projectPath: string, worktreeId: string, mode: AgentMode | null): Promise<void> {
    databaseService.setWorktreeMode(projectPath, worktreeId, mode);
  }

  // Set mode for a worktree
  async setWorktreeMode(worktreeId: string, mode: AgentMode): Promise<void> {
    this.worktreeModes.set(worktreeId, mode);
    const worktree = this.worktrees.get(worktreeId);
    if (worktree) {
      worktree.mode = mode;
      this.worktrees.set(worktreeId, worktree);
      const project = projectService.getProject(worktree.projectId);
      if (project) {
        await this.saveWorktreeMode(project.path, worktreeId, mode);
      }
    }
  }

  // Get mode for a worktree
  getWorktreeMode(worktreeId: string): AgentMode | undefined {
    return this.worktreeModes.get(worktreeId);
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

    // Always use the canonical project ID to ensure consistent worktree IDs
    const canonicalProjectId = project.id;

    const mainPath = projectService.getMainWorktreePath(projectId);
    if (!mainPath || !existsSync(mainPath)) return [];

    // Load archived worktrees from persistent storage
    const archivedSet = await this.loadArchivedWorktrees(project.path, canonicalProjectId);
    // Merge with in-memory set
    for (const id of archivedSet) {
      this.archivedWorktrees.add(id);
    }

    // Load worktree modes from persistent storage
    const modesMap = await this.loadWorktreeModes(project.path, canonicalProjectId);
    for (const [id, mode] of modesMap) {
      this.worktreeModes.set(id, mode);
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
          const id = this.getOrCreateId(canonicalProjectId, path);

          const status = await this.getWorktreeStatus(path);
          const archived = this.archivedWorktrees.has(id);
          const { lastCommitDate, createdAt } = await this.getWorktreeDates(path, branch || 'HEAD', canonicalProjectId);

          // Check if this branch has been merged into default branch
          // Only mark merged if: all commits in main AND no uncommitted changes AND no ahead commits AND no active terminal sessions
          let merged = false;
          if (!isMain && branch && status.modified === 0 && status.staged === 0 && status.untracked === 0 && status.ahead === 0) {
            // Check for active terminal sessions first
            const hasActiveSessions = await this.hasActiveTerminalSessions(id);
            if (!hasActiveSessions) {
              merged = await this.checkIfMerged(canonicalProjectId, branch);
            }
          }

          const mode = this.worktreeModes.get(id);
          const worktree: Worktree = {
            id,
            projectId: canonicalProjectId,
            path,
            branch: branch || 'detached',
            isMain,
            merged,
            archived,
            mode,
            status,
            lastCommitDate,
            createdAt,
          };

          worktrees.push(worktree);
          this.worktrees.set(id, worktree);

          // Sync to SQLite for persistence
          if (!isMain) {
            databaseService.upsertWorktree(project.path, {
              id,
              projectId: canonicalProjectId,
              path,
              branch: branch || 'detached',
              archived,
              mode,
            });
            // Sync .mcp.json to ensure WORKTREE_ID matches the server's regenerated ID
            // This is needed because IDs are regenerated deterministically on server restart
            await this.syncAgentMcp(path, id, project.path);
          }
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
    options?: { newBranch?: boolean; baseBranch?: string; mode?: AgentMode }
  ): Promise<Worktree> {
    const project = projectService.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Always use the canonical project ID to ensure consistent worktree IDs
    const canonicalProjectId = project.id;

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

    const id = this.getOrCreateId(canonicalProjectId, worktreePath);
    const status = await this.getWorktreeStatus(worktreePath);
    const { lastCommitDate, createdAt } = await this.getWorktreeDates(worktreePath, branch, canonicalProjectId);

    // Set up Claude permissions for this worktree
    await this.setupClaudePermissions(worktreePath, project.path);

    // Set up agent MCP config so Claude has access to agent tools
    await this.setupAgentMcp(worktreePath, id, project.path);

    const mode = options?.mode;
    const worktree: Worktree = {
      id,
      projectId: canonicalProjectId,
      path: worktreePath,
      branch,
      isMain: false,
      merged: false,
      archived: false,
      mode,
      status,
      lastCommitDate,
      createdAt,
    };

    this.worktrees.set(id, worktree);

    // Persist to SQLite
    databaseService.upsertWorktree(project.path, {
      id,
      projectId: canonicalProjectId,
      path: worktreePath,
      branch,
      archived: false,
      mode,
    });

    // Save mode to in-memory map too
    if (mode) {
      this.worktreeModes.set(id, mode);
    }

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

  // Set up MCP config for agent to communicate with orchestrator
  private async setupAgentMcp(worktreePath: string, worktreeId: string, projectPath: string): Promise<void> {
    const mcpConfigPath = join(worktreePath, '.mcp.json');

    try {
      const agentMcpPath = resolve(projectPath, 'packages/mcp-agent/dist/index.js');

      const mcpConfig = {
        mcpServers: {
          'orchard-agent': {
            command: 'node',
            args: [agentMcpPath],
            env: {
              ORCHARD_API: 'http://localhost:3001',
              WORKTREE_ID: worktreeId,
            },
          },
        },
      };

      await writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
    } catch (err) {
      console.error('Error setting up agent MCP:', err);
    }
  }

  // Sync the .mcp.json file to ensure the WORKTREE_ID matches the server's ID
  // This is needed after server restart when worktree IDs are regenerated
  private async syncAgentMcp(worktreePath: string, worktreeId: string, projectPath: string): Promise<void> {
    const mcpConfigPath = join(worktreePath, '.mcp.json');

    // Only sync if .mcp.json exists (i.e., this was a created worktree, not main)
    if (!existsSync(mcpConfigPath)) {
      return;
    }

    try {
      // Read existing config and check if ID needs updating
      const existingContent = await readFile(mcpConfigPath, 'utf-8');
      const existingConfig = JSON.parse(existingContent);

      const currentId = existingConfig?.mcpServers?.['orchard-agent']?.env?.WORKTREE_ID;

      // Only update if the ID is different
      if (currentId !== worktreeId) {
        console.log(`Syncing .mcp.json for worktree ${worktreePath}: ${currentId} -> ${worktreeId}`);
        await this.setupAgentMcp(worktreePath, worktreeId, projectPath);
      }
    } catch (err) {
      // If we can't read/parse the existing config, regenerate it
      console.log(`Regenerating .mcp.json for worktree ${worktreePath} due to read error`);
      await this.setupAgentMcp(worktreePath, worktreeId, projectPath);
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

  // Get the last commit date and branch creation date for a worktree
  async getWorktreeDates(worktreePath: string, branch: string, projectId: string): Promise<{ lastCommitDate: string | null; createdAt: string | null }> {
    if (!existsSync(worktreePath)) {
      return { lastCommitDate: null, createdAt: null };
    }

    const git = simpleGit(worktreePath);
    const defaultBranch = await this.getDefaultBranch(projectId);

    try {
      // Get the most recent commit date
      const lastCommitResult = await git.raw(['log', '-1', '--format=%cI']);
      const lastCommitDate = lastCommitResult.trim() || null;

      // Get the branch creation date (first commit unique to this branch)
      // This is the first commit after the branch diverged from the default branch
      let createdAt: string | null = null;
      try {
        // Find the merge-base and get the first commit after that
        const mergeBase = await git.raw(['merge-base', branch, defaultBranch]);
        if (mergeBase.trim()) {
          // Get the first commit after the merge base on this branch
          const firstCommit = await git.raw(['log', '--format=%cI', '--reverse', `${mergeBase.trim()}..${branch}`]);
          const firstLine = firstCommit.trim().split('\n')[0];
          createdAt = firstLine || lastCommitDate; // Fall back to last commit if no unique commits
        }
      } catch {
        // If merge-base fails (e.g., for main branch), use the last commit date
        createdAt = lastCommitDate;
      }

      return { lastCommitDate, createdAt };
    } catch {
      return { lastCommitDate: null, createdAt: null };
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

  /**
   * Lightweight worktree listing - just gets branch names and IDs without git status checks.
   * Use this for orchestrator ticks where we don't need detailed status.
   */
  async listWorktreesLight(projectId: string): Promise<Array<{ id: string; branch: string; archived: boolean }>> {
    const project = projectService.getProject(projectId);
    if (!project) return [];

    const mainPath = projectService.getMainWorktreePath(projectId);
    if (!mainPath || !existsSync(mainPath)) return [];

    // Load archived set from SQLite
    const archivedSet = await this.loadArchivedWorktrees(project.path, project.id);

    const git = simpleGit(mainPath);
    const result = await git.raw(['worktree', 'list', '--porcelain']);
    const worktreeBlocks = result.split('\n\n').filter(Boolean);

    const worktrees: Array<{ id: string; branch: string; archived: boolean }> = [];

    for (const block of worktreeBlocks) {
      const lines = block.split('\n');
      let path = '';
      let branch = '';

      for (const line of lines) {
        if (line.startsWith('worktree ')) path = line.replace('worktree ', '');
        else if (line.startsWith('branch ')) branch = line.replace('branch refs/heads/', '');
      }

      if (path && path !== mainPath) {
        const id = this.getOrCreateId(project.id, path);
        const archived = archivedSet.has(id) || this.archivedWorktrees.has(id);
        worktrees.push({ id, branch: branch || 'detached', archived });
      }
    }

    return worktrees;
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

    // Persist to SQLite
    const project = projectService.getProject(worktree.projectId);
    if (project) {
      this.saveArchivedWorktree(project.path, worktreeId, false).catch(console.error);
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

    // Persist to SQLite
    const project = projectService.getProject(worktree.projectId);
    if (project) {
      await this.saveArchivedWorktree(project.path, worktreeId, true);
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
