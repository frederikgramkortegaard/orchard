import { worktreeService } from './worktree.service.js';
import { projectService } from './project.service.js';
import { daemonClient } from '../pty/daemon-client.js';
import { simpleGit } from 'simple-git';
import { join } from 'path';

export interface OrchestratorSession {
  id: string;
  projectId: string;
  terminalSessionId: string;
  createdAt: Date;
}

export interface OrchestratorCommand {
  type: 'create-feature' | 'merge' | 'status' | 'list-worktrees';
  args: Record<string, string>;
}

interface TaskCompletion {
  worktreeId: string;
  sessionId: string;
  completedAt: Date;
  branch?: string;
}

class OrchestratorService {
  private sessions = new Map<string, OrchestratorSession>();
  private completions: TaskCompletion[] = [];

  // Called by daemon client when task complete is detected
  recordCompletion(worktreeId: string, sessionId: string, branch?: string): void {
    this.completions.push({
      worktreeId,
      sessionId,
      completedAt: new Date(),
      branch,
    });
    console.log(`Task completed: worktree ${worktreeId}, session ${sessionId}`);
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

    const mainPath = join(project.path, 'main');

    // Create a terminal session for the orchestrator Claude via daemon
    const terminalSessionId = await daemonClient.createSession(
      `orchestrator-${projectId}`,
      project.path,
      mainPath,
      'claude --dangerously-skip-permissions'  // Orchestrator has full permissions in project
    );

    const session: OrchestratorSession = {
      id: `orch-${projectId}`,
      projectId,
      terminalSessionId,
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
    const { name, description } = args;
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

    // Get project path for session storage
    const project = projectService.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Create a Claude terminal session for this worktree via daemon
    // Use --dangerously-skip-permissions since worktree is inside the trusted project folder
    const terminalSessionId = await daemonClient.createSession(
      worktree.id,
      project.path,
      worktree.path,
      'claude --dangerously-skip-permissions'
    );

    // Handle the bypass permissions prompt and send task
    // Step 1: Wait for bypass prompt to appear
    setTimeout(() => {
      // Step 2: Arrow down to select "Yes, I accept"
      daemonClient.writeToSession(terminalSessionId, '\x1b[B');

      setTimeout(() => {
        // Step 3: Press enter to confirm
        daemonClient.writeToSession(terminalSessionId, '\r');

        // Step 4: Wait for Claude to be ready, then send task
        if (description) {
          setTimeout(() => {
            // Send the task
            daemonClient.writeToSession(terminalSessionId, description);

            setTimeout(() => {
              // Press enter to submit the task
              daemonClient.writeToSession(terminalSessionId, '\r');
              console.log(`Sent task to session ${terminalSessionId}`);
            }, 500);
          }, 3000);
        }
      }, 200);
    }, 4000);

    return JSON.stringify({
      success: true,
      worktree: {
        id: worktree.id,
        branch: worktree.branch,
        path: worktree.path,
      },
      terminalSessionId,
      message: `Created feature branch "${branchName}" with Claude session`,
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
    const sessions = await daemonClient.listSessions();
    const projectSessions = sessions.filter(s =>
      worktrees.some(w => w.id === s.worktreeId) || s.worktreeId.startsWith(`orchestrator-${projectId}`)
    );

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
      activeTerminals: projectSessions.length,
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

  async destroySession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    await daemonClient.destroySession(session.terminalSessionId);
    this.sessions.delete(sessionId);
    return true;
  }

  // Send a prompt to a specific worktree's Claude session
  async sendPromptToWorktree(worktreeId: string, prompt: string): Promise<boolean> {
    const sessions = await daemonClient.getSessionsForWorktree(worktreeId);
    if (sessions.length === 0) {
      return false;
    }

    // Send to the first session for this worktree
    const session = sessions[0];
    // Send prompt, then enter to submit
    daemonClient.writeToSession(session.id, prompt);
    setTimeout(() => {
      daemonClient.writeToSession(session.id, '\r');
    }, 500);
    return true;
  }

  // Get all active terminal sessions that can receive prompts
  async getActiveWorktreeSessions(projectId: string): Promise<Array<{ worktreeId: string; sessionId: string; branch: string }>> {
    const worktrees = worktreeService.getWorktreesForProject(projectId);
    const result: Array<{ worktreeId: string; sessionId: string; branch: string }> = [];

    for (const worktree of worktrees) {
      const sessions = await daemonClient.getSessionsForWorktree(worktree.id);
      if (sessions.length > 0) {
        result.push({
          worktreeId: worktree.id,
          sessionId: sessions[0].id,
          branch: worktree.branch,
        });
      }
    }

    return result;
  }
}

export const orchestratorService = new OrchestratorService();
