import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import OpenAI from 'openai';
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
  enabled: boolean;
  provider: 'ollama' | 'openai';
  baseUrl: string;
  model: string;
  tickIntervalMs: number;
  maxConsecutiveFailures: number;
  autoRestartDeadSessions: boolean;
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
  enabled: true,
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3.1:8b',
  tickIntervalMs: 30000, // 30 seconds
  maxConsecutiveFailures: 3,
  autoRestartDeadSessions: true,
};

// Tool definitions for the LLM
const ORCHESTRATOR_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_worktree',
      description: 'Create a new feature worktree and start a Claude agent to work on a task',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name for the feature branch (e.g., "user-auth", "api-refactor")',
          },
          task: {
            type: 'string',
            description: 'The task description to send to the Claude agent',
          },
        },
        required: ['name', 'task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_task',
      description: 'Send a task or message to an existing Claude agent in a worktree',
      parameters: {
        type: 'object',
        properties: {
          worktreeId: {
            type: 'string',
            description: 'The ID of the worktree containing the agent',
          },
          message: {
            type: 'string',
            description: 'The message or task to send to the agent',
          },
        },
        required: ['worktreeId', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'merge_worktree',
      description: 'Merge a completed feature branch into main',
      parameters: {
        type: 'object',
        properties: {
          worktreeId: {
            type: 'string',
            description: 'The ID of the worktree to merge',
          },
          deleteAfterMerge: {
            type: 'boolean',
            description: 'Whether to delete the worktree after merging (default: false)',
          },
        },
        required: ['worktreeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_message',
      description: 'Send a status message or response to the user',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The message to send to the user',
          },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_status',
      description: 'Check the status of a specific worktree or all worktrees',
      parameters: {
        type: 'object',
        properties: {
          worktreeId: {
            type: 'string',
            description: 'Optional: specific worktree ID to check. If omitted, checks all.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'no_action',
      description: 'Indicate that no action is needed at this time. Use this when the system is healthy and no intervention is required.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Brief reason why no action is needed',
          },
        },
        required: ['reason'],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are the orchestrator for a multi-agent development system called Orchard. Your role is to:

1. Monitor and manage Claude Code agents working in git worktrees
2. Process user requests and delegate tasks to appropriate agents
3. Merge completed work and maintain code quality
4. Keep the user informed of progress

You receive periodic tick updates with the current system state. Based on this state, decide what actions to take.

Guidelines:
- If agents are working normally and no user messages are pending, use no_action
- If a user message is pending, process it and either create a new worktree or send to an existing agent
- If an agent reports task completion, consider if the work should be merged
- If an agent has a question, help answer it or escalate to the user
- If sessions are dead, they will be auto-restarted - no action needed
- Be concise in your responses

Available tools:
- create_worktree: Start a new feature with a Claude agent
- send_task: Send instructions to an existing agent
- merge_worktree: Merge completed work into main
- send_message: Communicate with the user
- check_status: Get detailed status of worktrees
- no_action: When no intervention is needed`;

/**
 * Orchestrator Loop Service
 *
 * An LLM-powered orchestrator loop that:
 * - Ticks every 30 seconds (configurable)
 * - Calls Ollama (local LLM) to make decisions
 * - Executes tool calls through existing services
 * - Logs all decisions to .orchard/activity-log.jsonl
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
  private openai: OpenAI | null = null;
  private conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  // Track pending completions and questions
  private pendingCompletions: DetectedPattern[] = [];
  private pendingQuestions: DetectedPattern[] = [];
  private pendingErrors: DetectedPattern[] = [];

  constructor(config: Partial<OrchestratorLoopConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Load config from .orchard/config.json
   */
  private async loadConfig(projectPath: string): Promise<void> {
    const configPath = join(projectPath, '.orchard', 'config.json');

    if (existsSync(configPath)) {
      try {
        const content = await readFile(configPath, 'utf-8');
        const fileConfig = JSON.parse(content);

        if (fileConfig.orchestratorLoop) {
          this.config = { ...this.config, ...fileConfig.orchestratorLoop };
          console.log('[OrchestratorLoop] Loaded config from .orchard/config.json');
        }
      } catch (error) {
        console.error('[OrchestratorLoop] Error loading config:', error);
      }
    } else {
      // Create default config file
      await this.saveConfig(projectPath);
    }
  }

  /**
   * Save config to .orchard/config.json
   */
  private async saveConfig(projectPath: string): Promise<void> {
    const configPath = join(projectPath, '.orchard', 'config.json');
    const dir = dirname(configPath);

    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const configData = {
      orchestratorLoop: {
        enabled: this.config.enabled,
        provider: this.config.provider,
        baseUrl: this.config.baseUrl,
        model: this.config.model,
        tickIntervalMs: this.config.tickIntervalMs,
      },
    };

    await writeFile(configPath, JSON.stringify(configData, null, 2));
    console.log('[OrchestratorLoop] Saved default config to .orchard/config.json');
  }

  /**
   * Initialize the OpenAI client for Ollama
   */
  private initializeOpenAI(): void {
    this.openai = new OpenAI({
      baseURL: this.config.baseUrl,
      apiKey: 'ollama', // Ollama doesn't need a real key
    });
    console.log(`[OrchestratorLoop] Initialized OpenAI client for ${this.config.provider} at ${this.config.baseUrl}`);
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

      // Load config from project
      const project = projectService.getProject(this.projectId);
      if (project) {
        await this.loadConfig(project.path);
      }

      // Check if enabled
      if (!this.config.enabled) {
        console.log('[OrchestratorLoop] Loop is disabled in config');
        this.state = LoopState.STOPPED;
        this.emit('state:change', this.state);
        return;
      }

      // Initialize OpenAI client
      this.initializeOpenAI();

      // Log startup
      await activityLoggerService.log({
        type: 'event',
        category: 'system',
        summary: 'Orchestrator loop started (Ollama)',
        details: {
          config: this.config,
          projectId: this.projectId,
          model: this.config.model,
        },
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

      console.log(`[OrchestratorLoop] Started for project ${this.projectId} using ${this.config.model}`);
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

    // Re-initialize OpenAI if URL changed
    if (config.baseUrl || config.provider) {
      this.initializeOpenAI();
    }

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

      // Auto-restart dead sessions first
      if (this.config.autoRestartDeadSessions && context.deadSessions.length > 0) {
        await this.restartDeadSessions(context.deadSessions, correlationId);
      }

      // Call LLM for decisions
      await this.callLLMForDecisions(context, correlationId);

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
   * Call the LLM for decisions
   */
  private async callLLMForDecisions(context: TickContext, correlationId: string): Promise<void> {
    if (!this.openai) {
      console.log('[OrchestratorLoop] OpenAI client not initialized, skipping LLM call');
      return;
    }

    // Build the tick message
    const tickMessage = this.formatTickMessage(context);

    // Add to conversation history
    this.conversationHistory.push({
      role: 'user',
      content: tickMessage,
    });

    // Keep conversation history manageable (last 20 exchanges)
    if (this.conversationHistory.length > 40) {
      this.conversationHistory = this.conversationHistory.slice(-40);
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...this.conversationHistory,
        ],
        tools: ORCHESTRATOR_TOOLS,
        tool_choice: 'auto',
      });

      const assistantMessage = response.choices[0]?.message;
      if (!assistantMessage) {
        console.log('[OrchestratorLoop] No response from LLM');
        return;
      }

      // Add assistant response to history
      this.conversationHistory.push(assistantMessage);

      // Log the LLM's reasoning
      if (assistantMessage.content) {
        await activityLoggerService.log({
          type: 'decision',
          category: 'orchestrator',
          summary: `LLM reasoning: ${assistantMessage.content.slice(0, 200)}`,
          details: { fullContent: assistantMessage.content },
          correlationId,
        });
      }

      // Execute tool calls
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          await this.executeToolCall(toolCall, correlationId);
        }
      }
    } catch (error: any) {
      console.error('[OrchestratorLoop] LLM call failed:', error.message);
      await activityLoggerService.log({
        type: 'error',
        category: 'orchestrator',
        summary: `LLM call failed: ${error.message}`,
        details: { error: error.stack },
        correlationId,
      });
    }
  }

  /**
   * Format the tick context as a message for the LLM
   */
  private formatTickMessage(context: TickContext): string {
    const lines: string[] = [
      `[TICK #${context.tickNumber} | ${context.timestamp.toISOString()}]`,
      '',
      'Current State:',
    ];

    // Pending user messages
    if (context.pendingUserMessages > 0) {
      lines.push(`- Pending user messages: ${context.pendingUserMessages}`);
    }

    // Active agents
    if (context.activeAgents.length > 0) {
      lines.push(`- Active agents: ${context.activeAgents.length}`);
      for (const agent of context.activeAgents) {
        const sessionStatus = agent.hasActiveSession ? 'active' : 'no session';
        lines.push(`  - ${agent.branch} (${agent.worktreeId}): ${agent.status}, ${sessionStatus}`);
      }
    } else {
      lines.push('- No active agents');
    }

    // Dead sessions
    if (context.deadSessions.length > 0) {
      lines.push(`- Dead sessions (auto-restarting): ${context.deadSessions.join(', ')}`);
    }

    // Recent completions
    if (context.completions.length > 0) {
      lines.push(`- Recent task completions: ${context.completions.length}`);
      for (const c of context.completions) {
        lines.push(`  - ${c.worktreeId}: Task completed`);
      }
    }

    // Questions from agents
    if (context.questions.length > 0) {
      lines.push(`- Agent questions: ${context.questions.length}`);
      for (const q of context.questions) {
        lines.push(`  - ${q.worktreeId}: "${q.content.slice(-100)}"`);
      }
    }

    // Errors
    if (context.errors.length > 0) {
      lines.push(`- Errors detected: ${context.errors.length}`);
      for (const e of context.errors) {
        lines.push(`  - ${e.worktreeId}: "${e.content.slice(-100)}"`);
      }
    }

    lines.push('');
    lines.push('What actions should be taken?');

    return lines.join('\n');
  }

  /**
   * Execute a tool call from the LLM
   */
  private async executeToolCall(
    toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
    correlationId: string
  ): Promise<void> {
    const { name, arguments: argsStr } = toolCall.function;
    let args: Record<string, any>;

    try {
      args = JSON.parse(argsStr);
    } catch {
      console.error(`[OrchestratorLoop] Invalid tool arguments for ${name}:`, argsStr);
      return;
    }

    console.log(`[OrchestratorLoop] Executing tool: ${name}`, args);

    await activityLoggerService.log({
      type: 'action',
      category: 'orchestrator',
      summary: `Executing tool: ${name}`,
      details: { tool: name, arguments: args },
      correlationId,
    });

    try {
      switch (name) {
        case 'create_worktree':
          await this.toolCreateWorktree(args.name, args.task, correlationId);
          break;
        case 'send_task':
          await this.toolSendTask(args.worktreeId, args.message, correlationId);
          break;
        case 'merge_worktree':
          await this.toolMergeWorktree(args.worktreeId, args.deleteAfterMerge, correlationId);
          break;
        case 'send_message':
          await this.toolSendMessage(args.message, correlationId);
          break;
        case 'check_status':
          await this.toolCheckStatus(args.worktreeId, correlationId);
          break;
        case 'no_action':
          await activityLoggerService.log({
            type: 'decision',
            category: 'orchestrator',
            summary: `No action needed: ${args.reason}`,
            details: { reason: args.reason },
            correlationId,
          });
          break;
        default:
          console.log(`[OrchestratorLoop] Unknown tool: ${name}`);
      }
    } catch (error: any) {
      console.error(`[OrchestratorLoop] Tool ${name} failed:`, error.message);
      await activityLoggerService.log({
        type: 'error',
        category: 'orchestrator',
        summary: `Tool ${name} failed: ${error.message}`,
        details: { tool: name, error: error.stack },
        correlationId,
      });
    }
  }

  /**
   * Tool: Create a new worktree with an agent
   */
  private async toolCreateWorktree(name: string, task: string, correlationId: string): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project) throw new Error('Project not found');

    // Use orchestrator service to create the feature
    const result = await orchestratorService.executeCommand(`orch-${projectId}`, {
      type: 'create-feature',
      args: { name, description: task },
    });

    const parsed = JSON.parse(result);

    await activityLoggerService.log({
      type: 'action',
      category: 'worktree',
      summary: `Created worktree for feature: ${name}`,
      details: { name, task, result: parsed },
      correlationId,
    });

    this.emit('worktree:created', parsed);
  }

  /**
   * Tool: Send a task to an existing agent
   */
  private async toolSendTask(worktreeId: string, message: string, correlationId: string): Promise<void> {
    const success = await orchestratorService.sendPromptToWorktree(worktreeId, message);

    await activityLoggerService.log({
      type: 'action',
      category: 'agent',
      summary: `Sent task to agent in ${worktreeId}`,
      details: { worktreeId, message: message.slice(0, 200), success },
      correlationId,
    });

    if (!success) {
      throw new Error(`No active session for worktree ${worktreeId}`);
    }
  }

  /**
   * Tool: Merge a worktree
   */
  private async toolMergeWorktree(
    worktreeId: string,
    deleteAfterMerge: boolean = false,
    correlationId: string
  ): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) throw new Error('Worktree not found');

    const session = orchestratorService.getSessionForProject(projectId);
    if (!session) throw new Error('No orchestrator session');

    const result = await orchestratorService.executeCommand(session.id, {
      type: 'merge',
      args: { source: worktree.branch },
    });

    const parsed = JSON.parse(result);

    await activityLoggerService.log({
      type: 'action',
      category: 'worktree',
      summary: `Merged worktree ${worktreeId}`,
      details: { worktreeId, branch: worktree.branch, result: parsed },
      correlationId,
    });

    if (deleteAfterMerge && parsed.success) {
      await worktreeService.deleteWorktree(worktreeId, true);
    }
  }

  /**
   * Tool: Send a message to the user
   */
  private async toolSendMessage(message: string, correlationId: string): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    // Add to chat.json (not message queue)
    const project = projectService.getProject(projectId);
    if (project?.path) {
      const chatPath = join(project.path, '.orchard', 'chat.json');
      let messages: Array<{ id: string; projectId: string; text: string; timestamp: string; from: string }> = [];

      try {
        if (existsSync(chatPath)) {
          const data = await readFile(chatPath, 'utf-8');
          messages = JSON.parse(data);
        }
      } catch {
        messages = [];
      }

      messages.push({
        id: randomUUID(),
        projectId,
        text: message,
        timestamp: new Date().toISOString(),
        from: 'orchestrator',
      });

      await writeFile(chatPath, JSON.stringify(messages, null, 2), 'utf-8');
    }

    await activityLoggerService.log({
      type: 'event',
      category: 'user',
      summary: `Orchestrator message: ${message.slice(0, 100)}`,
      details: { message },
      correlationId,
    });

    this.emit('message:sent', { message });
  }

  /**
   * Tool: Check status
   */
  private async toolCheckStatus(worktreeId: string | undefined, correlationId: string): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    if (worktreeId) {
      const worktree = worktreeService.getWorktree(worktreeId);
      const sessions = await daemonClient.getSessionsForWorktree(worktreeId);

      await activityLoggerService.log({
        type: 'event',
        category: 'agent',
        summary: `Status check for ${worktreeId}`,
        details: {
          worktree: worktree ? { id: worktree.id, branch: worktree.branch } : null,
          hasSession: sessions.length > 0,
        },
        correlationId,
      });
    } else {
      const worktrees = await worktreeService.loadWorktreesForProject(projectId);

      await activityLoggerService.log({
        type: 'event',
        category: 'agent',
        summary: `Status check for all worktrees`,
        details: {
          worktreeCount: worktrees.length,
          worktrees: worktrees.map(w => ({ id: w.id, branch: w.branch })),
        },
        correlationId,
      });
    }
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
        daemonClient.writeToSession(session.id, '\x1b[B');
        setTimeout(() => {
          daemonClient.writeToSession(session.id, '\r');
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
