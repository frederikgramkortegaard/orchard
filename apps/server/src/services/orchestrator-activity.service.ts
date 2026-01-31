import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { activityLoggerService, type ActivityCategory } from './activity-logger.service.js';
import { worktreeService } from './worktree.service.js';
import { orchestratorService } from './orchestrator.service.js';
import { daemonClient } from '../pty/daemon-client.js';
import { projectService } from './project.service.js';

export type ActionType =
  | 'CREATE_WORKTREE'
  | 'SEND_TASK'
  | 'MERGE_WORKTREE'
  | 'ARCHIVE_WORKTREE'
  | 'SEND_MESSAGE'
  | 'NUDGE_AGENT'
  | 'CHECK_STATUS'
  | 'RESPOND_TO_QUESTION'
  | 'LOG_ACTIVITY'
  | 'GET_PENDING_MESSAGES';

export type ActionInitiator = 'orchestrator' | 'user' | 'system' | 'tick' | 'script';

export interface OrchestratorAction {
  type: ActionType;
  params: Record<string, unknown>;
  initiator: ActionInitiator;
  correlationId: string;
  timestamp: Date;
}

export interface SideEffect {
  type: string;
  description: string;
  data?: unknown;
}

export interface ActionResult {
  success: boolean;
  action: OrchestratorAction;
  result?: unknown;
  error?: string;
  duration: number;
  sideEffects: SideEffect[];
}

export interface CreateWorktreeParams {
  projectId: string;
  name: string;
  task?: string;
  startAgent?: boolean;
}

export interface SendTaskParams {
  worktreeId: string;
  message: string;
}

export interface MergeWorktreeParams {
  projectId: string;
  worktreeId: string;
  squash?: boolean;
  deleteAfter?: boolean;
}

export interface ArchiveWorktreeParams {
  worktreeId: string;
  deleteFiles?: boolean;
}

export interface SendMessageParams {
  projectId: string;
  message: string;
  replyTo?: string;
}

export interface NudgeAgentParams {
  worktreeId: string;
  message?: string;
}

export interface CheckStatusParams {
  projectId: string;
  worktreeId?: string;
}

export interface LogActivityParams {
  summary: string;
  category: ActivityCategory;
  details?: Record<string, unknown>;
}

export interface ActionFilter {
  since?: Date;
  until?: Date;
  type?: ActionType;
  initiator?: ActionInitiator;
  success?: boolean;
  limit?: number;
}

type ActionHandler = (params: Record<string, unknown>) => Promise<unknown>;

class OrchestratorActivityService {
  private actionHistory: ActionResult[] = [];
  private eventEmitter = new EventEmitter();
  private handlers: Record<ActionType, ActionHandler>;

  constructor() {
    this.handlers = {
      CREATE_WORKTREE: this.handleCreateWorktree.bind(this),
      SEND_TASK: this.handleSendTask.bind(this),
      MERGE_WORKTREE: this.handleMergeWorktree.bind(this),
      ARCHIVE_WORKTREE: this.handleArchiveWorktree.bind(this),
      SEND_MESSAGE: this.handleSendMessage.bind(this),
      NUDGE_AGENT: this.handleNudgeAgent.bind(this),
      CHECK_STATUS: this.handleCheckStatus.bind(this),
      RESPOND_TO_QUESTION: this.handleRespondToQuestion.bind(this),
      LOG_ACTIVITY: this.handleLogActivity.bind(this),
      GET_PENDING_MESSAGES: this.handleGetPendingMessages.bind(this),
    };
  }

  async executeAction(action: OrchestratorAction): Promise<ActionResult> {
    const startTime = Date.now();
    const correlationId = action.correlationId || randomUUID();

    // Pre-action logging
    await activityLoggerService.log({
      type: 'action',
      category: this.categorize(action.type),
      summary: `Starting: ${action.type}`,
      details: { action: { ...action, correlationId }, phase: 'start' },
      correlationId,
    });

    try {
      // Validate action
      this.validateAction(action);

      // Execute through appropriate handler
      const handler = this.handlers[action.type];
      if (!handler) {
        throw new Error(`Unknown action type: ${action.type}`);
      }

      const result = await handler(action.params);

      const actionResult: ActionResult = {
        success: true,
        action: { ...action, correlationId },
        result,
        duration: Date.now() - startTime,
        sideEffects: this.collectSideEffects(action.type, result),
      };

      // Post-action logging
      await activityLoggerService.log({
        type: 'action',
        category: this.categorize(action.type),
        summary: `Completed: ${action.type}`,
        details: { action: { ...action, correlationId }, result, phase: 'complete' },
        correlationId,
        duration: actionResult.duration,
      });

      // Store in history
      this.actionHistory.push(actionResult);
      this.trimHistory();

      // Emit event for subscribers
      this.eventEmitter.emit('action:complete', actionResult);

      return actionResult;
    } catch (error: any) {
      const actionResult: ActionResult = {
        success: false,
        action: { ...action, correlationId },
        error: error.message,
        duration: Date.now() - startTime,
        sideEffects: [],
      };

      // Error logging
      await activityLoggerService.log({
        type: 'error',
        category: this.categorize(action.type),
        summary: `Failed: ${action.type} - ${error.message}`,
        details: { action: { ...action, correlationId }, error: error.stack, phase: 'error' },
        correlationId,
        duration: actionResult.duration,
      });

      this.actionHistory.push(actionResult);
      this.trimHistory();
      this.eventEmitter.emit('action:error', actionResult);

      return actionResult;
    }
  }

  // Convenience methods that wrap executeAction
  async createWorktree(params: CreateWorktreeParams): Promise<ActionResult> {
    return this.executeAction({
      type: 'CREATE_WORKTREE',
      params,
      initiator: 'orchestrator',
      correlationId: randomUUID(),
      timestamp: new Date(),
    });
  }

  async sendTaskToAgent(params: SendTaskParams): Promise<ActionResult> {
    return this.executeAction({
      type: 'SEND_TASK',
      params,
      initiator: 'orchestrator',
      correlationId: randomUUID(),
      timestamp: new Date(),
    });
  }

  async mergeWorktree(params: MergeWorktreeParams): Promise<ActionResult> {
    return this.executeAction({
      type: 'MERGE_WORKTREE',
      params,
      initiator: 'orchestrator',
      correlationId: randomUUID(),
      timestamp: new Date(),
    });
  }

  async archiveWorktree(params: ArchiveWorktreeParams): Promise<ActionResult> {
    return this.executeAction({
      type: 'ARCHIVE_WORKTREE',
      params,
      initiator: 'orchestrator',
      correlationId: randomUUID(),
      timestamp: new Date(),
    });
  }

  async sendUserMessage(params: SendMessageParams): Promise<ActionResult> {
    return this.executeAction({
      type: 'SEND_MESSAGE',
      params,
      initiator: 'orchestrator',
      correlationId: randomUUID(),
      timestamp: new Date(),
    });
  }

  async nudgeAgent(params: NudgeAgentParams): Promise<ActionResult> {
    return this.executeAction({
      type: 'NUDGE_AGENT',
      params,
      initiator: 'orchestrator',
      correlationId: randomUUID(),
      timestamp: new Date(),
    });
  }

  async checkStatus(params: CheckStatusParams): Promise<ActionResult> {
    return this.executeAction({
      type: 'CHECK_STATUS',
      params,
      initiator: 'orchestrator',
      correlationId: randomUUID(),
      timestamp: new Date(),
    });
  }

  async logActivity(params: LogActivityParams): Promise<ActionResult> {
    return this.executeAction({
      type: 'LOG_ACTIVITY',
      params,
      initiator: 'orchestrator',
      correlationId: randomUUID(),
      timestamp: new Date(),
    });
  }

  // Activity log access
  async getActivityLog(since?: Date): Promise<any[]> {
    return activityLoggerService.query({ since });
  }

  async getActionHistory(filter?: ActionFilter): Promise<ActionResult[]> {
    let history = [...this.actionHistory];

    if (filter) {
      if (filter.since) {
        history = history.filter(r => r.action.timestamp >= filter.since!);
      }
      if (filter.until) {
        history = history.filter(r => r.action.timestamp <= filter.until!);
      }
      if (filter.type) {
        history = history.filter(r => r.action.type === filter.type);
      }
      if (filter.initiator) {
        history = history.filter(r => r.action.initiator === filter.initiator);
      }
      if (filter.success !== undefined) {
        history = history.filter(r => r.success === filter.success);
      }
    }

    // Sort by timestamp descending
    history.sort((a, b) => b.action.timestamp.getTime() - a.action.timestamp.getTime());

    if (filter?.limit) {
      history = history.slice(0, filter.limit);
    }

    return history;
  }

  // Subscribe to action events
  onActionComplete(callback: (result: ActionResult) => void): () => void {
    this.eventEmitter.on('action:complete', callback);
    return () => this.eventEmitter.off('action:complete', callback);
  }

  onActionError(callback: (result: ActionResult) => void): () => void {
    this.eventEmitter.on('action:error', callback);
    return () => this.eventEmitter.off('action:error', callback);
  }

  // Private handler implementations
  private async handleCreateWorktree(params: Record<string, unknown>): Promise<unknown> {
    const { projectId, name, task, startAgent = true } = params as CreateWorktreeParams;

    if (!projectId || !name) {
      throw new Error('projectId and name are required');
    }

    // Sanitize branch name
    const branchName = `feature/${(name as string).toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;

    // Get the default branch
    const defaultBranch = await worktreeService.getDefaultBranch(projectId);

    // Create worktree
    const worktree = await worktreeService.createWorktree(projectId, branchName, {
      newBranch: true,
      baseBranch: defaultBranch,
    });

    let terminalSessionId: string | null = null;

    // Optionally start an agent
    if (startAgent) {
      const project = projectService.getProject(projectId);
      if (project) {
        terminalSessionId = await daemonClient.createSession(
          worktree.id,
          project.path,
          worktree.path,
          'claude --dangerously-skip-permissions'
        );

        // Handle permissions prompt and send task if provided
        if (task) {
          setTimeout(() => {
            daemonClient.writeToSession(terminalSessionId!, '\x1b[B');
            setTimeout(() => {
              daemonClient.writeToSession(terminalSessionId!, '\r');
              setTimeout(() => {
                daemonClient.writeToSession(terminalSessionId!, task as string);
                setTimeout(() => {
                  daemonClient.writeToSession(terminalSessionId!, '\r');
                }, 500);
              }, 3000);
            }, 200);
          }, 4000);
        }
      }
    }

    return {
      worktree: {
        id: worktree.id,
        branch: worktree.branch,
        path: worktree.path,
      },
      terminalSessionId,
    };
  }

  private async handleSendTask(params: Record<string, unknown>): Promise<unknown> {
    const { worktreeId, message } = params as SendTaskParams;

    if (!worktreeId || !message) {
      throw new Error('worktreeId and message are required');
    }

    const success = await orchestratorService.sendPromptToWorktree(worktreeId, message);
    if (!success) {
      throw new Error('No active session found for worktree');
    }

    return { sent: true, worktreeId };
  }

  private async handleMergeWorktree(params: Record<string, unknown>): Promise<unknown> {
    const { projectId, worktreeId, squash = true, deleteAfter = false } = params as MergeWorktreeParams;

    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) {
      throw new Error('Worktree not found');
    }

    // Use orchestrator service to merge
    const session = orchestratorService.getSessionForProject(projectId);
    if (!session) {
      throw new Error('No orchestrator session for project');
    }

    const result = await orchestratorService.executeCommand(session.id, {
      type: 'merge',
      args: { source: worktree.branch },
    });

    const mergeResult = JSON.parse(result);

    // Optionally delete the worktree after merge
    if (deleteAfter && mergeResult.success) {
      await worktreeService.deleteWorktree(worktreeId, true);
    }

    return mergeResult;
  }

  private async handleArchiveWorktree(params: Record<string, unknown>): Promise<unknown> {
    const { worktreeId, deleteFiles = false } = params as ArchiveWorktreeParams;

    const worktree = await worktreeService.archiveWorktree(worktreeId);
    if (!worktree) {
      throw new Error('Worktree not found or is main worktree');
    }

    // Close any active sessions for this worktree
    const sessions = await daemonClient.getSessionsForWorktree(worktreeId);
    for (const session of sessions) {
      await daemonClient.destroySession(session.id);
    }

    // Optionally delete the worktree files
    if (deleteFiles) {
      await worktreeService.deleteWorktree(worktreeId, true);
    }

    return { archived: true, worktreeId, filesDeleted: deleteFiles };
  }

  private async handleSendMessage(params: Record<string, unknown>): Promise<unknown> {
    const { projectId, message, replyTo } = params as SendMessageParams;

    // For now, log the message. In a full implementation, this would
    // send to a chat interface or message queue
    await activityLoggerService.log({
      type: 'event',
      category: 'user',
      summary: `Orchestrator message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`,
      details: { projectId, message, replyTo },
      correlationId: randomUUID(),
    });

    return { sent: true, message };
  }

  private async handleNudgeAgent(params: Record<string, unknown>): Promise<unknown> {
    const { worktreeId, message = 'Are you still working? Please provide a status update.' } = params as NudgeAgentParams;

    if (!worktreeId) {
      throw new Error('worktreeId is required');
    }

    const success = await orchestratorService.sendPromptToWorktree(worktreeId, message);
    if (!success) {
      throw new Error('No active session found for worktree');
    }

    return { nudged: true, worktreeId, message };
  }

  private async handleCheckStatus(params: Record<string, unknown>): Promise<unknown> {
    const { projectId, worktreeId } = params as CheckStatusParams;

    if (worktreeId) {
      // Check specific worktree
      const worktree = worktreeService.getWorktree(worktreeId);
      if (!worktree) {
        throw new Error('Worktree not found');
      }

      const sessions = await daemonClient.getSessionsForWorktree(worktreeId);
      const status = await worktreeService.getWorktreeStatus(worktree.path);

      return {
        worktree: {
          id: worktree.id,
          branch: worktree.branch,
          status,
          hasActiveSession: sessions.length > 0,
        },
      };
    }

    // Check all worktrees for project
    const worktrees = await worktreeService.loadWorktreesForProject(projectId);
    const activeSessions = await orchestratorService.getActiveWorktreeSessions(projectId);

    return {
      projectId,
      worktrees: worktrees.map(w => ({
        id: w.id,
        branch: w.branch,
        status: w.status,
        isMain: w.isMain,
        merged: w.merged,
        archived: w.archived,
      })),
      activeSessions: activeSessions.length,
    };
  }

  private async handleRespondToQuestion(params: Record<string, unknown>): Promise<unknown> {
    // This handler would integrate with a question queue system
    // For Phase 1, we just log the response
    const { worktreeId, response } = params as { worktreeId: string; response: string };

    if (worktreeId && response) {
      const success = await orchestratorService.sendPromptToWorktree(worktreeId, response);
      return { responded: success, worktreeId };
    }

    return { responded: false };
  }

  private async handleLogActivity(params: Record<string, unknown>): Promise<unknown> {
    const { summary, category, details = {} } = params as LogActivityParams;

    await activityLoggerService.log({
      type: 'decision',
      category,
      summary,
      details,
      correlationId: randomUUID(),
    });

    return { logged: true };
  }

  private async handleGetPendingMessages(params: Record<string, unknown>): Promise<unknown> {
    // This would integrate with a message queue system
    // For Phase 1, return empty array
    return { messages: [] };
  }

  // Helper methods
  private validateAction(action: OrchestratorAction): void {
    if (!action.type) {
      throw new Error('Action type is required');
    }
    if (!this.handlers[action.type]) {
      throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  private categorize(actionType: ActionType): ActivityCategory {
    switch (actionType) {
      case 'CREATE_WORKTREE':
      case 'MERGE_WORKTREE':
      case 'ARCHIVE_WORKTREE':
        return 'worktree';
      case 'SEND_TASK':
      case 'NUDGE_AGENT':
      case 'CHECK_STATUS':
        return 'agent';
      case 'SEND_MESSAGE':
      case 'RESPOND_TO_QUESTION':
      case 'GET_PENDING_MESSAGES':
        return 'user';
      case 'LOG_ACTIVITY':
        return 'orchestrator';
      default:
        return 'system';
    }
  }

  private collectSideEffects(actionType: ActionType, result: unknown): SideEffect[] {
    const effects: SideEffect[] = [];

    if (actionType === 'CREATE_WORKTREE' && result) {
      const r = result as { worktree?: { id: string }; terminalSessionId?: string };
      if (r.worktree) {
        effects.push({
          type: 'worktree_created',
          description: `Created worktree ${r.worktree.id}`,
          data: r.worktree,
        });
      }
      if (r.terminalSessionId) {
        effects.push({
          type: 'session_created',
          description: `Started Claude session ${r.terminalSessionId}`,
        });
      }
    }

    if (actionType === 'ARCHIVE_WORKTREE' && result) {
      const r = result as { worktreeId: string; filesDeleted?: boolean };
      effects.push({
        type: 'worktree_archived',
        description: `Archived worktree ${r.worktreeId}`,
      });
      if (r.filesDeleted) {
        effects.push({
          type: 'files_deleted',
          description: 'Worktree files deleted',
        });
      }
    }

    return effects;
  }

  private trimHistory(): void {
    // Keep last 1000 actions in memory
    const maxHistory = 1000;
    if (this.actionHistory.length > maxHistory) {
      this.actionHistory = this.actionHistory.slice(-maxHistory);
    }
  }
}

export const orchestratorActivityService = new OrchestratorActivityService();
