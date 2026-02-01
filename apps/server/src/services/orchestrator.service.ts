import { worktreeService } from './worktree.service.js';
import { projectService } from './project.service.js';
import { simpleGit } from 'simple-git';
import { join } from 'path';

export interface OrchestratorSession {
  id: string;
  projectId: string;
  createdAt: Date;
}

export interface OrchestratorCommand {
  type: 'create-feature' | 'merge' | 'status' | 'list-worktrees';
  args: Record<string, string>;
}

interface TaskCompletion {
  worktreeId: string;
  completedAt: Date;
  branch?: string;
}

class OrchestratorService {
  private sessions = new Map<string, OrchestratorSession>();
  private completions: TaskCompletion[] = [];

  // Record task completion
  recordCompletion(worktreeId: string, branch?: string): void {
    this.completions.push({
      worktreeId,
      completedAt: new Date(),
      branch,
    });
    console.log(`Task completed: worktree ${worktreeId}`);
  }

  getRecentCompletions(since?: Date): TaskCompletion[] {
    if (!since) {
      return this.completions;
    }
    return this.completions.filter(c => c.completedAt >= since);
  }

  clearCompletions(): void {
    this.completions = [];
  }

  async createSession(projectId: string): Promise<OrchestratorSession> {
    const project = projectService.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const session: OrchestratorSession = {
      id: `orch-${projectId}`,
      projectId,
      createdAt: new Date(),
    };

    this.sessions.set(session.id, session);
    return session;
  }

  async executeCommand(sessionId: string, command: OrchestratorCommand): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Orchestrator session not found');
    }

    switch (command.type) {
      case 'create-feature':
        return await this.createFeature(session.projectId, command.args);
      case 'merge':
        return await this.mergeBranch(session.projectId, command.args);
      case 'status':
        return await this.getProjectStatus(session.projectId);
      case 'list-worktrees':
        return await this.listWorktrees(session.projectId);
      default:
        throw new Error(`Unknown command: ${command.type}`);
    }
  }

  private async createFeature(projectId: string, args: Record<string, string>): Promise<string> {
    const { name } = args;
    if (!name) {
      throw new Error('Feature name is required');
    }

    // Sanitize branch name
    const branchName = `feature/${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;

    // Get the default branch for this project
    const defaultBranch = await worktreeService.getDefaultBranch(projectId);

    // Create worktree with new branch
    const worktree = await worktreeService.createWorktree(projectId, branchName, {
      newBranch: true,
      baseBranch: defaultBranch,
    });

    return JSON.stringify({
      success: true,
      worktree: {
        id: worktree.id,
        branch: worktree.branch,
        path: worktree.path,
      },
      message: `Created feature branch "${branchName}"`,
    });
  }

  private async mergeBranch(projectId: string, args: Record<string, string>): Promise<string> {
    const { source, target } = args;
    if (!source) {
      throw new Error('Source branch is required');
    }

    const mainPath = projectService.getMainWorktreePath(projectId);
    if (!mainPath) {
      throw new Error('Project main worktree not found');
    }

    // Get the default branch if target not specified
    const defaultBranch = await worktreeService.getDefaultBranch(projectId);
    const targetBranch = target || defaultBranch;

    const git = simpleGit(mainPath);

    try {
      // Fetch latest
      await git.fetch();

      // Checkout target branch
      await git.checkout(targetBranch);

      // Try merge
      const mergeResult = await git.merge([source, '--no-ff']);

      if (mergeResult.conflicts && mergeResult.conflicts.length > 0) {
        return JSON.stringify({
          success: false,
          hasConflicts: true,
          conflicts: mergeResult.conflicts,
          message: `Merge has conflicts in: ${mergeResult.conflicts.join(', ')}`,
        });
      }

      return JSON.stringify({
        success: true,
        message: `Successfully merged "${source}" into "${targetBranch}"`,
        mergeResult,
      });
    } catch (err: any) {
      // Check if it's a conflict
      if (err.message?.includes('CONFLICT')) {
        const status = await git.status();
        return JSON.stringify({
          success: false,
          hasConflicts: true,
          conflicts: status.conflicted,
          message: `Merge conflicts detected: ${status.conflicted.join(', ')}`,
        });
      }
      throw err;
    }
  }

  private async getProjectStatus(projectId: string): Promise<string> {
    const worktrees = await worktreeService.loadWorktreesForProject(projectId);
    const project = projectService.getProject(projectId);

    return JSON.stringify({
      project: {
        id: project?.id,
        name: project?.name,
        path: project?.path,
      },
      worktrees: worktrees.map((w) => ({
        id: w.id,
        branch: w.branch,
        path: w.path,
        isMain: w.isMain,
        status: w.status,
      })),
    });
  }

  private async listWorktrees(projectId: string): Promise<string> {
    const worktrees = await worktreeService.loadWorktreesForProject(projectId);
    return JSON.stringify(worktrees);
  }

  getSession(sessionId: string): OrchestratorSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionForProject(projectId: string): OrchestratorSession | undefined {
    return this.sessions.get(`orch-${projectId}`);
  }

  destroySession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.sessions.delete(sessionId);
    return true;
  }
}

export const orchestratorService = new OrchestratorService();
