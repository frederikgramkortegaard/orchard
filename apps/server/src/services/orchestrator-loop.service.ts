import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { activityLoggerService } from './activity-logger.service.js';
import { sessionPersistenceService } from './session-persistence.service.js';
import { terminalMonitorService, type DetectedPattern } from './terminal-monitor.service.js';
import { messageQueueService } from './message-queue.service.js';
import { worktreeService } from './worktree.service.js';
import { orchestratorService } from './orchestrator.service.js';
import { projectService } from './project.service.js';
import { daemonClient } from '../pty/daemon-client.js';

export enum LoopState {
  STOPPED = 'STOPPED',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  DEGRADED = 'DEGRADED',
  STOPPING = 'STOPPING',
}

export interface OrchestratorLoopConfig {
  tickIntervalMs: number;
  maxConsecutiveFailures: number;
  autoRestartDeadSessions: boolean;
  autoProcessCompletions: boolean;
}

export interface AgentStatus {
  worktreeId: string;
  branch: string;
  status: 'WORKING' | 'IDLE' | 'READY' | 'BLOCKED' | 'DEAD' | 'UNKNOWN';
  lastActivity?: string;
  hasActiveSession: boolean;
  sessionId?: string;
}

export interface TickContext {
  timestamp: Date;
  tickNumber: number;
  pendingUserMessages: number;
  activeAgents: AgentStatus[];
  deadSessions: string[];
  completions: DetectedPattern[];
  questions: DetectedPattern[];
  errors: DetectedPattern[];
  projectId: string;
}

export interface LoopStatus {
  state: LoopState;
  tickNumber: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  consecutiveFailures: number;
  config: OrchestratorLoopConfig;
}

const DEFAULT_CONFIG: OrchestratorLoopConfig = {
  tickIntervalMs: 30000, // 30 seconds
  maxConsecutiveFailures: 3,
  autoRestartDeadSessions: true,
  autoProcessCompletions: true,
};

/**
 * Orchestrator Loop Service
 *
 * A reliable terminal-based orchestrator loop that:
 * - Ticks every 30 seconds
 * - Checks for new user messages, agent completions
 * - Auto-restarts dead sessions
 * - Logs to .orchard/activity-log.jsonl
 */
class OrchestratorLoopService extends EventEmitter {
  private config: OrchestratorLoopConfig;
  private state: LoopState = LoopState.STOPPED;
  private tickNumber = 0;
  private consecutiveFailures = 0;
  private lastTickAt: Date | null = null;
  private nextTickAt: Date | null = null;
  private tickInterval: NodeJS.Timeout | null = null;
  private projectId: string | null = null;

  // Track pending completions and questions
  private pendingCompletions: DetectedPattern[] = [];
  private pendingQuestions: DetectedPattern[] = [];
  private pendingErrors: DetectedPattern[] = [];

  constructor(config: Partial<OrchestratorLoopConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the loop - must be called before start
   */
  async initialize(): Promise<void> {
    // Initialize dependent services
    await sessionPersistenceService.initialize();
    await terminalMonitorService.initialize();

    // Subscribe to terminal monitor events
    terminalMonitorService.on('pattern:task_complete', (detection: DetectedPattern) => {
      this.pendingCompletions.push(detection);
      this.emit('completion', detection);
    });

    terminalMonitorService.on('pattern:question', (detection: DetectedPattern) => {
      this.pendingQuestions.push(detection);
      this.emit('question', detection);
    });

    terminalMonitorService.on('pattern:error', (detection: DetectedPattern) => {
      this.pendingErrors.push(detection);
      this.emit('error', detection);
    });

    console.log('[OrchestratorLoop] Initialized');
  }

  /**
   * Start the orchestrator loop
   */
  async start(projectId?: string): Promise<void> {
    if (this.state !== LoopState.STOPPED) {
      throw new Error(`Cannot start loop from state: ${this.state}`);
    }

    this.state = LoopState.STARTING;
    this.emit('state:change', this.state);

    try {
      // Set project context
      if (projectId) {
        this.projectId = projectId;
      } else {
        const projects = projectService.getAllProjects();
        if (projects.length > 0) {
          this.projectId = projects[0].id;
        }
      }

      if (!this.projectId) {
        throw new Error('No project available');
      }

      // Log startup
      await activityLoggerService.log({
        type: 'event',
        category: 'system',
        summary: 'Orchestrator loop started',
        details: { config: this.config, projectId: this.projectId },
        correlationId: randomUUID(),
      });

      // Validate existing sessions
      const validation = await sessionPersistenceService.validateAllSessions();
      if (validation.dead.length > 0) {
        console.log(`[OrchestratorLoop] Found ${validation.dead.length} dead sessions to restore`);
      }

      // Start monitoring existing sessions
      const sessions = sessionPersistenceService.getSessionsForProject(this.projectId);
      for (const session of sessions) {
        terminalMonitorService.startMonitoring(session.id, session.worktreeId, session.projectId);
      }

      // Schedule first tick
      this.scheduleNextTick();

      this.state = LoopState.RUNNING;
      this.emit('state:change', this.state);

      console.log(`[OrchestratorLoop] Started for project ${this.projectId}`);
    } catch (error: any) {
      this.state = LoopState.STOPPED;
      this.emit('state:change', this.state);
      throw error;
    }
  }

  /**
   * Stop the orchestrator loop
   */
  async stop(): Promise<void> {
    if (this.state === LoopState.STOPPED) return;

    this.state = LoopState.STOPPING;
    this.emit('state:change', this.state);

    // Clear tick interval
    if (this.tickInterval) {
      clearTimeout(this.tickInterval);
      this.tickInterval = null;
    }

    // Log shutdown
    await activityLoggerService.log({
      type: 'event',
      category: 'system',
      summary: 'Orchestrator loop stopped',
      details: { tickNumber: this.tickNumber, consecutiveFailures: this.consecutiveFailures },
      correlationId: randomUUID(),
    });

    this.state = LoopState.STOPPED;
    this.nextTickAt = null;
    this.emit('state:change', this.state);

    console.log('[OrchestratorLoop] Stopped');
  }

  /**
   * Pause the loop
   */
  pause(): void {
    if (this.state !== LoopState.RUNNING) return;

    if (this.tickInterval) {
      clearTimeout(this.tickInterval);
      this.tickInterval = null;
    }

    this.state = LoopState.PAUSED;
    this.nextTickAt = null;
    this.emit('state:change', this.state);

    console.log('[OrchestratorLoop] Paused');
  }

  /**
   * Resume the loop
   */
  resume(): void {
    if (this.state !== LoopState.PAUSED) return;

    this.state = LoopState.RUNNING;
    this.scheduleNextTick();
    this.emit('state:change', this.state);

    console.log('[OrchestratorLoop] Resumed');
  }

  /**
   * Trigger a manual tick
   */
  async manualTick(): Promise<TickContext> {
    return await this.executeTick();
  }

  /**
   * Get current status
   */
  getStatus(): LoopStatus {
    return {
      state: this.state,
      tickNumber: this.tickNumber,
      lastTickAt: this.lastTickAt?.toISOString() || null,
      nextTickAt: this.nextTickAt?.toISOString() || null,
      consecutiveFailures: this.consecutiveFailures,
      config: this.config,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OrchestratorLoopConfig>): void {
    this.config = { ...this.config, ...config };

    // Reschedule if running
    if (this.state === LoopState.RUNNING && this.tickInterval) {
      clearTimeout(this.tickInterval);
      this.scheduleNextTick();
    }
  }

  /**
   * Schedule the next tick
   */
  private scheduleNextTick(): void {
    this.nextTickAt = new Date(Date.now() + this.config.tickIntervalMs);
    this.tickInterval = setTimeout(() => this.executeTick(), this.config.tickIntervalMs);
  }

  /**
   * Execute a single tick
   */
  private async executeTick(): Promise<TickContext> {
    if (this.state !== LoopState.RUNNING && this.state !== LoopState.DEGRADED) {
      throw new Error('Loop not running');
    }

    this.tickNumber++;
    this.lastTickAt = new Date();
    const correlationId = `tick-${this.tickNumber}`;

    let context: TickContext;

    try {
      // Gather tick context
      context = await this.gatherTickContext();

      // Log tick
      await activityLoggerService.log({
        type: 'tick',
        category: 'system',
        summary: `Orchestrator tick #${this.tickNumber}`,
        details: {
          pendingMessages: context.pendingUserMessages,
          activeAgents: context.activeAgents.length,
          deadSessions: context.deadSessions.length,
          completions: context.completions.length,
          questions: context.questions.length,
        },
        correlationId,
      });

      // Emit tick event
      this.emit('tick', this.tickNumber, context);

      // Process tick actions
      await this.processTickActions(context, correlationId);

      // Reset failure counter on success
      this.consecutiveFailures = 0;
      if (this.state === LoopState.DEGRADED) {
        this.state = LoopState.RUNNING;
        this.emit('state:change', this.state);
      }
    } catch (error: any) {
      this.consecutiveFailures++;
      console.error(`[OrchestratorLoop] Tick #${this.tickNumber} failed:`, error.message);

      await activityLoggerService.log({
        type: 'error',
        category: 'system',
        summary: `Tick #${this.tickNumber} failed: ${error.message}`,
        details: { error: error.stack, consecutiveFailures: this.consecutiveFailures },
        correlationId,
      });

      // Enter degraded state if too many failures
      if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        this.state = LoopState.DEGRADED;
        this.emit('state:change', this.state);
      }

      // Return empty context on error
      context = {
        timestamp: new Date(),
        tickNumber: this.tickNumber,
        pendingUserMessages: 0,
        activeAgents: [],
        deadSessions: [],
        completions: [],
        questions: [],
        errors: [],
        projectId: this.projectId || '',
      };
    }

    // Schedule next tick
    if (this.state === LoopState.RUNNING || this.state === LoopState.DEGRADED) {
      this.scheduleNextTick();
    }

    return context;
  }

  /**
   * Gather context for the tick
   */
  private async gatherTickContext(): Promise<TickContext> {
    const projectId = this.projectId || '';

    // Get worktrees and their statuses
    const worktrees = await worktreeService.loadWorktreesForProject(projectId);
    const sessions = sessionPersistenceService.getSessionsForProject(projectId);
    const sessionByWorktree = new Map(sessions.map(s => [s.worktreeId, s]));

    // Get dead sessions
    const deadSessions = await sessionPersistenceService.getDeadSessions();
    const deadWorktreeIds = deadSessions.map(s => s.worktreeId);

    // Build agent status list
    const activeAgents: AgentStatus[] = worktrees
      .filter(w => !w.isMain)
      .map(w => {
        const session = sessionByWorktree.get(w.id);
        const isDead = deadWorktreeIds.includes(w.id);

        return {
          worktreeId: w.id,
          branch: w.branch,
          status: this.determineAgentStatus(w, !!session, isDead),
          lastActivity: w.lastCommitDate || undefined,
          hasActiveSession: !!session && !isDead,
          sessionId: session?.id,
        };
      });

    // Get pending user messages
    const unreadMessages = await messageQueueService.getUnreadMessages(projectId);

    // Get pending completions/questions/errors and clear them
    const completions = [...this.pendingCompletions];
    const questions = [...this.pendingQuestions];
    const errors = [...this.pendingErrors];
    this.pendingCompletions = [];
    this.pendingQuestions = [];
    this.pendingErrors = [];

    return {
      timestamp: new Date(),
      tickNumber: this.tickNumber,
      pendingUserMessages: unreadMessages.length,
      activeAgents,
      deadSessions: deadWorktreeIds,
      completions,
      questions,
      errors,
      projectId,
    };
  }

  /**
   * Determine agent status
   */
  private determineAgentStatus(
    worktree: any,
    hasSession: boolean,
    isDead: boolean
  ): AgentStatus['status'] {
    if (isDead) return 'DEAD';
    if (!hasSession) return 'IDLE';
    if (worktree.merged) return 'READY';
    if (worktree.status?.modified > 0 || worktree.status?.staged > 0) return 'WORKING';
    return 'WORKING';
  }

  /**
   * Process tick actions
   */
  private async processTickActions(context: TickContext, correlationId: string): Promise<void> {
    // 1. Auto-restart dead sessions
    if (this.config.autoRestartDeadSessions && context.deadSessions.length > 0) {
      await this.restartDeadSessions(context.deadSessions, correlationId);
    }

    // 2. Process completions
    if (this.config.autoProcessCompletions && context.completions.length > 0) {
      await this.processCompletions(context.completions, correlationId);
    }

    // 3. Log questions that need attention
    if (context.questions.length > 0) {
      await this.logPendingQuestions(context.questions, correlationId);
    }

    // 4. Log errors
    if (context.errors.length > 0) {
      await this.logErrors(context.errors, correlationId);
    }

    // 5. Process pending user messages
    if (context.pendingUserMessages > 0) {
      await this.notifyPendingMessages(context.projectId, correlationId);
    }
  }

  /**
   * Restart dead sessions
   */
  private async restartDeadSessions(worktreeIds: string[], correlationId: string): Promise<void> {
    for (const worktreeId of worktreeIds) {
      try {
        const restored = await sessionPersistenceService.restoreSession(worktreeId);
        if (restored) {
          // Start monitoring the restored session
          terminalMonitorService.startMonitoring(restored.id, restored.worktreeId, restored.projectId);

          await activityLoggerService.log({
            type: 'action',
            category: 'agent',
            summary: `Auto-restarted dead session for ${worktreeId}`,
            details: { worktreeId, newSessionId: restored.id },
            correlationId,
          });

          this.emit('session:restarted', { worktreeId, sessionId: restored.id });
        }
      } catch (error: any) {
        console.error(`[OrchestratorLoop] Failed to restart session for ${worktreeId}:`, error.message);
      }
    }
  }

  /**
   * Process task completions
   */
  private async processCompletions(completions: DetectedPattern[], correlationId: string): Promise<void> {
    for (const completion of completions) {
      await activityLoggerService.log({
        type: 'event',
        category: 'agent',
        summary: `Task completed in ${completion.worktreeId}`,
        details: { worktreeId: completion.worktreeId, sessionId: completion.sessionId },
        correlationId,
      });

      // Record completion in orchestrator service
      orchestratorService.recordCompletion(completion.worktreeId, completion.sessionId);

      // Mark as handled
      await terminalMonitorService.markHandled(completion.id, completion.projectId);

      this.emit('task:completed', completion);
    }
  }

  /**
   * Log pending questions
   */
  private async logPendingQuestions(questions: DetectedPattern[], correlationId: string): Promise<void> {
    for (const question of questions) {
      await activityLoggerService.log({
        type: 'event',
        category: 'agent',
        summary: `Agent has question in ${question.worktreeId}`,
        details: {
          worktreeId: question.worktreeId,
          sessionId: question.sessionId,
          content: question.content.slice(-200),
        },
        correlationId,
      });

      this.emit('agent:question', question);
    }
  }

  /**
   * Log errors
   */
  private async logErrors(errors: DetectedPattern[], correlationId: string): Promise<void> {
    for (const error of errors) {
      await activityLoggerService.log({
        type: 'error',
        category: 'agent',
        summary: `Error detected in ${error.worktreeId}`,
        details: {
          worktreeId: error.worktreeId,
          sessionId: error.sessionId,
          content: error.content.slice(-200),
        },
        correlationId,
      });

      this.emit('agent:error', error);
    }
  }

  /**
   * Notify about pending user messages
   */
  private async notifyPendingMessages(projectId: string, correlationId: string): Promise<void> {
    const messages = await messageQueueService.getUnreadMessages(projectId);

    if (messages.length > 0) {
      await activityLoggerService.log({
        type: 'event',
        category: 'user',
        summary: `${messages.length} pending user message(s)`,
        details: { count: messages.length, messageIds: messages.map(m => m.id) },
        correlationId,
      });

      this.emit('messages:pending', { projectId, count: messages.length, messages });
    }
  }

  /**
   * Send a message to a specific agent
   */
  async sendToAgent(worktreeId: string, message: string): Promise<boolean> {
    const session = sessionPersistenceService.getSession(worktreeId);
    if (!session) {
      console.log(`[OrchestratorLoop] No session found for ${worktreeId}`);
      return false;
    }

    try {
      daemonClient.writeToSession(session.id, message);
      // Press enter after a short delay
      setTimeout(() => {
        daemonClient.writeToSession(session.id, '\r');
      }, 100);

      await activityLoggerService.log({
        type: 'action',
        category: 'orchestrator',
        summary: `Sent message to agent in ${worktreeId}`,
        details: { worktreeId, message: message.slice(0, 200) },
        correlationId: randomUUID(),
      });

      return true;
    } catch (error: any) {
      console.error(`[OrchestratorLoop] Failed to send to agent:`, error.message);
      return false;
    }
  }

  /**
   * Create a new agent session for a worktree
   */
  async createAgentSession(
    worktreeId: string,
    projectId: string,
    cwd: string,
    initialTask?: string
  ): Promise<string> {
    const session = await sessionPersistenceService.ensureSession(
      worktreeId,
      projectId,
      cwd,
      'claude --dangerously-skip-permissions'
    );

    // Start monitoring
    terminalMonitorService.startMonitoring(session.id, worktreeId, projectId);

    // Handle permission prompt and send initial task
    if (initialTask) {
      setTimeout(() => {
        // Arrow down to select "Yes, I accept"
        daemonClient.writeToSession(session.id, '\x1b[B');

        setTimeout(() => {
          // Press enter to confirm
          daemonClient.writeToSession(session.id, '\r');

          // Wait for Claude to be ready, then send task
          setTimeout(() => {
            daemonClient.writeToSession(session.id, initialTask);
            setTimeout(() => {
              daemonClient.writeToSession(session.id, '\r');
              console.log(`[OrchestratorLoop] Sent initial task to ${worktreeId}`);
            }, 500);
          }, 3000);
        }, 200);
      }, 4000);
    }

    await activityLoggerService.log({
      type: 'action',
      category: 'agent',
      summary: `Created agent session for ${worktreeId}`,
      details: { worktreeId, sessionId: session.id, hasTask: !!initialTask },
      correlationId: randomUUID(),
    });

    return session.id;
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(callback: (state: LoopState) => void): () => void {
    this.on('state:change', callback);
    return () => this.off('state:change', callback);
  }

  /**
   * Subscribe to tick events
   */
  onTick(callback: (tickNumber: number, context: TickContext) => void): () => void {
    this.on('tick', callback);
    return () => this.off('tick', callback);
  }
}

export const orchestratorLoopService = new OrchestratorLoopService();
