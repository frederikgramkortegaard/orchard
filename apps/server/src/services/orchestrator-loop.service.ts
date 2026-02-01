// @ts-nocheck
// TODO: Fix OpenAI types and activityLoggerService types
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import OpenAI from 'openai';
import { activityLoggerService } from './activity-logger.service.js';
import { sessionPersistenceService } from './session-persistence.service.js';
import { terminalMonitorService, type DetectedPattern } from './terminal-monitor.service.js';
import { worktreeService } from './worktree.service.js';
import { orchestratorService } from './orchestrator.service.js';
import { projectService } from './project.service.js';
import { databaseService } from './database.service.js';
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

export interface MergeQueueItem {
  worktreeId: string;
  branch: string;
  completedAt: string;
  summary: string;
  hasCommits: boolean;
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
  mergeQueue: MergeQueueItem[];
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
  tickIntervalMs: 30000, // 30 seconds (used as max wait time for no_action)
  maxConsecutiveFailures: 3,
  autoRestartDeadSessions: true,
};

// Smart tick timing constants
const MIN_TICK_INTERVAL_MS = 1000; // Minimum 1 second between ticks
const NO_ACTION_WAIT_MS = 3000; // Wait 3 seconds when idle (no pending work)
const ACTION_WAIT_MS = 0; // Tick immediately after action

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
  {
    type: 'function',
    function: {
      name: 'get_user_messages',
      description: 'Read recent chat messages from the user. Use this to see what the user has requested.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of messages to retrieve (default: 10)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_agent_output',
      description: 'Get recent terminal output from a specific worktree agent. Useful for checking what an agent is doing or if it is stuck.',
      parameters: {
        type: 'object',
        properties: {
          worktreeId: {
            type: 'string',
            description: 'The ID of the worktree to get output from',
          },
          lines: {
            type: 'number',
            description: 'Number of recent lines to retrieve (default: 50)',
          },
        },
        required: ['worktreeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_worktrees',
      description: 'Get all worktrees with their status, git info, and active sessions. Use this for a comprehensive view of all agents.',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['all', 'active', 'merged', 'archived'],
            description: 'Filter worktrees by status (default: all)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'archive_worktree',
      description: 'Archive a completed worktree. Use this after work is merged and no longer needed.',
      parameters: {
        type: 'object',
        properties: {
          worktreeId: {
            type: 'string',
            description: 'The ID of the worktree to archive',
          },
        },
        required: ['worktreeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nudge_agent',
      description: 'Send enter presses to a stuck agent to wake it up. Use this when an agent appears idle or unresponsive.',
      parameters: {
        type: 'object',
        properties: {
          worktreeId: {
            type: 'string',
            description: 'The ID of the worktree containing the agent to nudge',
          },
        },
        required: ['worktreeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_file_tree',
      description: 'Get the project directory structure (top level). Useful for understanding the project layout.',
      parameters: {
        type: 'object',
        properties: {
          depth: {
            type: 'number',
            description: 'How many levels deep to show (default: 2)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_merge_queue',
      description: 'Get the list of completed worktrees waiting to be merged. Use this to see what branches are ready for merging.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'merge_from_queue',
      description: 'Merge a worktree from the merge queue into main. Use this after reviewing a completed task.',
      parameters: {
        type: 'object',
        properties: {
          worktreeId: {
            type: 'string',
            description: 'The ID of the worktree to merge from the queue',
          },
        },
        required: ['worktreeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_from_queue',
      description: 'Remove a worktree from the merge queue without merging. Use this if the work should be discarded.',
      parameters: {
        type: 'object',
        properties: {
          worktreeId: {
            type: 'string',
            description: 'The ID of the worktree to remove from the queue',
          },
        },
        required: ['worktreeId'],
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

COMMUNICATION STYLE:
When sending messages to the user, be conversational and friendly. Write like you're chatting with them, not sending status reports.
- Instead of: "Multiple pending user messages detected"
- Write: "Hey! I saw your messages. Let me take a look..."

- Instead of: "Task has been completed successfully"
- Write: "Done! I merged that feature for you."

- Instead of: "Creating worktree for feature implementation"
- Write: "On it! Starting a new agent to work on that..."

Keep responses concise but human-like. Be helpful and personable.

CRITICAL - WHEN TO USE no_action:
- If pendingUserMessages is 0 AND no completions/questions/errors, you MUST use no_action
- Do NOT send_message just to say "nothing to do" or "all agents are idle"
- Do NOT call get_user_messages if pendingUserMessages is already 0
- Only take action when there's actually something to respond to

Guidelines:
- If a user message is pending (pendingUserMessages > 0), process it
- If an agent reports task completion, consider merging
- If an agent has a question, help answer it
- If sessions are dead, they will be auto-restarted - no action needed
- Use archive_worktree to clean up merged worktrees
- Check the merge queue (mergeQueueSize > 0) for completed work ready to merge

MERGE QUEUE WORKFLOW:
When agents complete tasks, they add themselves to the merge queue. You should:
1. Use get_merge_queue to see what's waiting
2. Review the summary to ensure the work looks complete
3. Use merge_from_queue to merge, or remove_from_queue to discard
4. Archive the worktree after merging (optional, for cleanup)

Available tools:
- create_worktree: Start a new feature with a Claude agent
- send_task: Send instructions to an existing agent
- merge_worktree: Merge completed work into main (direct merge)
- merge_from_queue: Merge a worktree from the merge queue
- remove_from_queue: Remove a worktree from merge queue without merging
- get_merge_queue: List worktrees waiting to be merged
- send_message: Communicate with the user
- check_status: Get detailed status of worktrees
- get_user_messages: Read recent chat messages
- get_agent_output: See what an agent is doing (terminal output)
- list_worktrees: Get comprehensive worktree status
- archive_worktree: Archive completed worktrees
- nudge_agent: Wake up a stuck agent
- get_file_tree: See project directory structure
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

  // Smart tick timing
  private lastTickStartTime: number = 0;
  private lastActionWasNoAction: boolean = false;

  // Track which chat messages have been processed
  private lastProcessedMessageId: string | null = null;

  constructor(config: Partial<OrchestratorLoopConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Log to the text file that the UI reads (.orchard/orchestrator-log.txt)
   */
  private async logToTextFile(message: string): Promise<void> {
    if (!this.projectId) return;
    const project = projectService.getProject(this.projectId);
    if (!project?.path) return;

    const logPath = join(project.path, '.orchard', 'orchestrator-log.txt');
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;

    try {
      await appendFile(logPath, line);
    } catch (error) {
      console.error('[OrchestratorLoop] Failed to write to log file:', error);
    }
  }

  /**
   * Save lastProcessedMessageId to persist across restarts
   */
  private async saveLastProcessedMessageId(): Promise<void> {
    if (!this.projectId) return;
    const project = projectService.getProject(this.projectId);
    if (!project?.path) return;

    const statePath = join(project.path, '.orchard', 'orchestrator-state.json');
    try {
      const state = { lastProcessedMessageId: this.lastProcessedMessageId };
      await writeFile(statePath, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('[OrchestratorLoop] Failed to save state:', error);
    }
  }

  /**
   * Load lastProcessedMessageId from disk
   */
  private async loadLastProcessedMessageId(): Promise<void> {
    if (!this.projectId) return;
    const project = projectService.getProject(this.projectId);
    if (!project?.path) return;

    const statePath = join(project.path, '.orchard', 'orchestrator-state.json');
    try {
      if (existsSync(statePath)) {
        const content = await readFile(statePath, 'utf-8');
        const state = JSON.parse(content);
        if (state.lastProcessedMessageId) {
          this.lastProcessedMessageId = state.lastProcessedMessageId;
          console.log(`[OrchestratorLoop] Loaded lastProcessedMessageId: ${this.lastProcessedMessageId}`);
        }
      }
    } catch (error) {
      console.error('[OrchestratorLoop] Failed to load state:', error);
    }
  }

  /**
   * Mark all current messages as processed (for "clear pending" feature)
   */
  async markAllMessagesProcessed(): Promise<void> {
    const pendingMessages = await this.getPendingUserMessages();
    if (pendingMessages.length > 0) {
      const lastMessage = pendingMessages[pendingMessages.length - 1];
      this.lastProcessedMessageId = lastMessage.id;
      await this.saveLastProcessedMessageId();
      console.log(`[OrchestratorLoop] Marked all messages as processed up to ${lastMessage.id}`);
    }
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

      // Load persisted state (lastProcessedMessageId)
      await this.loadLastProcessedMessageId();

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
  async updateConfig(config: Partial<OrchestratorLoopConfig>): Promise<void> {
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

    // Persist config to disk
    if (this.projectId) {
      const project = projectService.getProject(this.projectId);
      if (project?.path) {
        await this.saveConfig(project.path);
      }
    }
  }

  /**
   * Get count of pending user messages (for UI display)
   */
  async getPendingMessageCount(): Promise<number> {
    const messages = await this.getPendingUserMessages();
    return messages.length;
  }

  /**
   * Schedule the next tick with smart timing
   * - If last action was no_action, wait 10 seconds
   * - If last action was a real action, tick immediately (min 2 seconds)
   * - Respects minimum interval to prevent runaway loops
   */
  private scheduleNextTick(immediate: boolean = false): void {
    // Calculate time since last tick started
    const timeSinceLastTick = Date.now() - this.lastTickStartTime;
    const minWait = Math.max(0, MIN_TICK_INTERVAL_MS - timeSinceLastTick);

    let waitTime: number;
    if (immediate) {
      // Tick immediately after action, but respect minimum interval
      waitTime = Math.max(minWait, ACTION_WAIT_MS);
    } else if (this.lastActionWasNoAction) {
      // Wait 10 seconds after no_action
      waitTime = Math.max(minWait, NO_ACTION_WAIT_MS);
    } else {
      // Default: use configured interval
      waitTime = Math.max(minWait, this.config.tickIntervalMs);
    }

    this.nextTickAt = new Date(Date.now() + waitTime);
    this.tickInterval = setTimeout(() => this.executeTick(), waitTime);

    console.log(`[OrchestratorLoop] Next tick in ${waitTime}ms (lastNoAction: ${this.lastActionWasNoAction})`);
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
    this.lastTickStartTime = Date.now();
    const correlationId = `tick-${this.tickNumber}`;

    let context: TickContext;
    let tookAction = false;

    try {
      // Get pending messages BEFORE gathering context (so we can mark them processed after)
      const pendingMessages = await this.getPendingUserMessages();

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

      // Skip LLM call if there's nothing actionable
      const hasWork = context.pendingUserMessages > 0 ||
                      context.completions.length > 0 ||
                      context.questions.length > 0 ||
                      context.errors.length > 0 ||
                      context.mergeQueue.length > 0;

      if (!hasWork) {
        await this.logToTextFile(`[TICK #${this.tickNumber}] Nothing to do - skipping LLM call`);
        this.lastActionWasNoAction = true;
      } else {
        // Call LLM for decisions - returns true if a real action was taken (not no_action)
        tookAction = await this.callLLMForDecisions(context, correlationId);
        this.lastActionWasNoAction = !tookAction;
      }

      // Mark pending messages as processed after LLM has seen them
      // This prevents the same messages from triggering responses every tick
      if (pendingMessages.length > 0) {
        const lastMessage = pendingMessages[pendingMessages.length - 1];
        this.markMessagesProcessed(lastMessage.id);
      }

      // Reset failure counter on success
      this.consecutiveFailures = 0;
      if (this.state === LoopState.DEGRADED) {
        this.state = LoopState.RUNNING;
        this.emit('state:change', this.state);
      }
    } catch (error: any) {
      this.consecutiveFailures++;
      this.lastActionWasNoAction = true; // Treat errors as no_action for timing
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

    // Schedule next tick with smart timing
    if (this.state === LoopState.RUNNING || this.state === LoopState.DEGRADED) {
      this.scheduleNextTick(tookAction);
    }

    return context;
  }

  /**
   * Call the LLM for decisions
   * @returns true if a real action was taken (not no_action), false otherwise
   */
  private async callLLMForDecisions(context: TickContext, correlationId: string): Promise<boolean> {
    if (!this.openai) {
      console.log('[OrchestratorLoop] OpenAI client not initialized, skipping LLM call');
      return false;
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

    // Build the full messages array for the request
    const fullMessages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      ...this.conversationHistory,
    ];

    // Log the full request to Ollama
    await activityLoggerService.log({
      type: 'llm_request',
      category: 'orchestrator',
      summary: `LLM request (tick #${context.tickNumber})`,
      details: {
        model: this.config.model,
        provider: this.config.provider,
        messages: fullMessages,
        toolCount: ORCHESTRATOR_TOOLS.length,
      },
      correlationId,
    });

    // Log to text file for UI visibility
    await this.logToTextFile(`[TICK #${context.tickNumber}] Sending request to ${this.config.model}...`);
    await this.logToTextFile(`  Context: ${context.pendingUserMessages} pending msgs, ${context.activeAgents.length} agents`);

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: fullMessages,
        tools: ORCHESTRATOR_TOOLS,
        tool_choice: 'auto',
      });

      const assistantMessage = response.choices[0]?.message;

      // Log the full response from Ollama
      await activityLoggerService.log({
        type: 'llm_response',
        category: 'orchestrator',
        summary: `LLM response: ${assistantMessage?.content?.slice(0, 100) || 'tool calls only'}`,
        details: {
          model: this.config.model,
          content: assistantMessage?.content || null,
          toolCalls: assistantMessage?.tool_calls?.map(tc => ({
            name: tc.function.name,
            arguments: tc.function.arguments,
          })) || [],
          usage: response.usage || null,
          finishReason: response.choices[0]?.finish_reason || null,
        },
        correlationId,
      });

      if (!assistantMessage) {
        console.log('[OrchestratorLoop] No response from LLM');
        await this.logToTextFile(`  ERROR: No response from LLM`);
        return false;
      }

      // Log response to text file
      const toolNames = assistantMessage.tool_calls?.map(tc => tc.function.name).join(', ') || 'none';
      await this.logToTextFile(`  Response: ${assistantMessage.content?.slice(0, 150) || '(no text)'}`);
      await this.logToTextFile(`  Tools called: ${toolNames}`);

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

      // Execute tool calls and track if any real action was taken
      let tookRealAction = false;
      const toolResults: string[] = [];
      let needsContinuation = false;

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const isNoAction = toolName === 'no_action';
          const isFinalAction = toolName === 'send_message' || toolName === 'create_worktree' || isNoAction;

          if (!isNoAction) {
            tookRealAction = true;
          }

          // Info-gathering tools need continuation
          if (['get_user_messages', 'get_agent_output', 'list_worktrees', 'check_status', 'get_file_tree'].includes(toolName)) {
            needsContinuation = true;
          }

          const result = await this.executeToolCall(toolCall, correlationId);
          toolResults.push(`${toolCall.function.name}: ${result}`);

          // Log tool result to text file
          await this.logToTextFile(`  Tool result: ${result}`);
        }

        // Add tool results to conversation history so LLM can see success/failure
        if (toolResults.length > 0) {
          const hasErrors = toolResults.some(r => r.includes('ERROR'));
          this.conversationHistory.push({
            role: 'user',
            content: `Tool execution results:\n${toolResults.join('\n')}${hasErrors ? '\n\nPlease inform the user about the error and try to fix it if possible.' : ''}`,
          });

          // If LLM called info-gathering tools, continue the conversation
          if (needsContinuation && !hasErrors) {
            await this.logToTextFile(`  Continuing conversation after info-gathering...`);
            // Recursive call to let LLM act on the info it gathered (max 3 turns)
            const continuedAction = await this.continueLLMConversation(correlationId, 3);
            tookRealAction = tookRealAction || continuedAction;
          }
        }
      }

      return tookRealAction;
    } catch (error: any) {
      console.error('[OrchestratorLoop] LLM call failed:', error.message);
      await this.logToTextFile(`  ERROR: LLM call failed - ${error.message}`);
      await activityLoggerService.log({
        type: 'error',
        category: 'orchestrator',
        summary: `LLM call failed: ${error.message}`,
        details: { error: error.stack },
        correlationId,
      });
      return false;
    }
  }

  /**
   * Continue LLM conversation after info-gathering tools
   * Allows the LLM to act on information it just retrieved
   */
  private async continueLLMConversation(correlationId: string, maxTurns: number): Promise<boolean> {
    if (maxTurns <= 0 || !this.openai) return false;

    const fullMessages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      ...this.conversationHistory,
    ];

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: fullMessages,
        tools: ORCHESTRATOR_TOOLS,
        tool_choice: 'auto',
      });

      const assistantMessage = response.choices[0]?.message;
      if (!assistantMessage) return false;

      // Log response
      const toolNames = assistantMessage.tool_calls?.map(tc => tc.function.name).join(', ') || 'none';
      await this.logToTextFile(`  [Continue] Response: ${assistantMessage.content?.slice(0, 100) || '(no text)'}`);
      await this.logToTextFile(`  [Continue] Tools: ${toolNames}`);

      this.conversationHistory.push(assistantMessage);

      let tookAction = false;
      let needsMoreTurns = false;

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolResults: string[] = [];

        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const isNoAction = toolName === 'no_action';

          if (!isNoAction) tookAction = true;

          // Check if still gathering info
          if (['get_user_messages', 'get_agent_output', 'list_worktrees', 'check_status', 'get_file_tree'].includes(toolName)) {
            needsMoreTurns = true;
          }

          const result = await this.executeToolCall(toolCall, correlationId);
          toolResults.push(`${toolCall.function.name}: ${result}`);
          await this.logToTextFile(`  [Continue] Tool result: ${result}`);
        }

        if (toolResults.length > 0) {
          this.conversationHistory.push({
            role: 'user',
            content: `Tool results:\n${toolResults.join('\n')}`,
          });

          // Continue if still gathering info
          if (needsMoreTurns) {
            const continued = await this.continueLLMConversation(correlationId, maxTurns - 1);
            return tookAction || continued;
          }
        }
      }

      return tookAction;
    } catch (error: any) {
      await this.logToTextFile(`  [Continue] ERROR: ${error.message}`);
      return false;
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

    // Merge queue
    if (context.mergeQueue.length > 0) {
      lines.push(`- Merge queue: ${context.mergeQueue.length} branches waiting`);
      for (const item of context.mergeQueue) {
        lines.push(`  - ${item.branch} (${item.worktreeId.slice(0, 8)}): ${item.summary || 'No summary'}`);
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
  ): Promise<string> {
    const { name, arguments: argsStr } = toolCall.function;
    let args: Record<string, any>;

    try {
      args = JSON.parse(argsStr);
    } catch {
      const error = `Invalid tool arguments for ${name}: ${argsStr}`;
      console.error(`[OrchestratorLoop] ${error}`);
      return `ERROR: ${error}`;
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
          return `SUCCESS: Created worktree feature/${args.name} and started agent with task`;
          break;
        case 'send_task':
          await this.toolSendTask(args.worktreeId, args.message, correlationId);
          return `SUCCESS: Sent task to agent in ${args.worktreeId}`;
        case 'merge_worktree':
          await this.toolMergeWorktree(args.worktreeId, args.deleteAfterMerge, correlationId);
          return `SUCCESS: Merged worktree ${args.worktreeId}`;
        case 'send_message':
          await this.toolSendMessage(args.message, correlationId);
          return `SUCCESS: Message sent to user`;
        case 'check_status':
          await this.toolCheckStatus(args.worktreeId, correlationId);
          return `SUCCESS: Status checked`;
        case 'no_action':
          await activityLoggerService.log({
            type: 'decision',
            category: 'orchestrator',
            summary: `No action needed: ${args.reason}`,
            details: { reason: args.reason },
            correlationId,
          });
          return `SUCCESS: No action taken - ${args.reason}`;
        case 'get_user_messages':
          await this.toolGetUserMessages(args.limit || 10, correlationId);
          return `SUCCESS: Retrieved user messages`;
        case 'get_agent_output':
          await this.toolGetAgentOutput(args.worktreeId, args.lines || 50, correlationId);
          return `SUCCESS: Retrieved agent output`;
        case 'list_worktrees':
          await this.toolListWorktrees(args.filter || 'all', correlationId);
          return `SUCCESS: Listed worktrees`;
        case 'archive_worktree':
          await this.toolArchiveWorktree(args.worktreeId, correlationId);
          return `SUCCESS: Archived worktree ${args.worktreeId}`;
        case 'nudge_agent':
          await this.toolNudgeAgent(args.worktreeId, correlationId);
          return `SUCCESS: Nudged agent in ${args.worktreeId}`;
        case 'get_file_tree':
          await this.toolGetFileTree(args.depth || 2, correlationId);
          return `SUCCESS: Retrieved file tree`;
        case 'get_merge_queue':
          await this.toolGetMergeQueue(correlationId);
          return `SUCCESS: Retrieved merge queue`;
        case 'merge_from_queue':
          await this.toolMergeFromQueue(args.worktreeId, correlationId);
          return `SUCCESS: Merged ${args.worktreeId} from queue`;
        case 'remove_from_queue':
          await this.toolRemoveFromQueue(args.worktreeId, correlationId);
          return `SUCCESS: Removed ${args.worktreeId} from queue`;
        default:
          return `ERROR: Unknown tool: ${name}`;
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
      // Return error so LLM can respond appropriately
      return `ERROR: Tool ${name} failed - ${error.message}`;
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

    // Create worktree directly using worktree service
    const branchName = `feature/${name}`;
    await this.logToTextFile(`Creating worktree: ${branchName}`);

    try {
      const worktree = await worktreeService.createWorktree(projectId, branchName, { newBranch: true, baseBranch: 'master' });

      await activityLoggerService.log({
        type: 'action',
        category: 'worktree',
        summary: `Created worktree for feature: ${name}`,
        details: { name, task, worktreeId: worktree.id, branch: branchName },
        correlationId,
      });

      await this.logToTextFile(`Created worktree ${worktree.id} for ${branchName}`);

      // Start a Claude agent in the worktree with the task
      if (task) {
        await this.createAgentSession(worktree.id, projectId, worktree.path, task);
        await this.logToTextFile(`Started agent with task: ${task.slice(0, 100)}...`);
      }

      this.emit('worktree:created', { worktreeId: worktree.id, branch: branchName });
    } catch (error: any) {
      await this.logToTextFile(`ERROR creating worktree: ${error.message}`);
      throw error;
    }
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

    const project = projectService.getProject(projectId);
    if (!project) throw new Error('Project not found');

    await this.logToTextFile(`Merging ${worktree.branch} into master...`);

    // Use git commands directly
    const { execSync } = await import('node:child_process');

    try {
      // Merge the branch into master from the main worktree
      execSync(`git merge ${worktree.branch} --no-edit`, {
        cwd: project.path,
        encoding: 'utf-8',
      });

      await this.logToTextFile(`Merged ${worktree.branch} successfully`);

      // Mark worktree as merged
      await worktreeService.markAsMerged(worktreeId);
    } catch (error: any) {
      await this.logToTextFile(`ERROR merging: ${error.message}`);
      throw error;
    }

    await activityLoggerService.log({
      type: 'action',
      category: 'worktree',
      summary: `Merged worktree ${worktreeId}`,
      details: { worktreeId, branch: worktree.branch },
      correlationId,
    });

    if (deleteAfterMerge) {
      await worktreeService.deleteWorktree(worktreeId, true);
    }
  }

  /**
   * Tool: Send a message to the user via chat
   * This logs to both activity log and chat so messages appear in the chat UI.
   */
  private async toolSendMessage(message: string, correlationId: string): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project) throw new Error('Project not found');

    // Log to activity log
    await activityLoggerService.log({
      type: 'event',
      category: 'orchestrator',
      summary: message,
      details: { message, source: 'send_message' },
      correlationId,
    });

    // Also add to chat so it appears in the chat UI
    databaseService.addChatMessage(project.path, {
      id: randomUUID(),
      projectId: project.id,
      from: 'orchestrator',
      text: message,
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
   * Tool: Get recent user messages from chat
   * Note: Messages are marked as processed by executeTick after the LLM responds
   */
  private async toolGetUserMessages(limit: number, correlationId: string): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project?.path) throw new Error('Project path not found');

    const chatPath = join(project.path, '.orchard', 'chat.json');
    let messages: Array<{ id: string; text: string; timestamp: string; from: string }> = [];

    try {
      if (existsSync(chatPath)) {
        const data = await readFile(chatPath, 'utf-8');
        messages = JSON.parse(data);
      }
    } catch {
      messages = [];
    }

    // Get only pending (unprocessed) user messages
    const userMessages = messages.filter(m => m.from === 'user');
    let pendingMessages: typeof userMessages = [];

    if (this.lastProcessedMessageId) {
      const lastIndex = userMessages.findIndex(m => m.id === this.lastProcessedMessageId);
      if (lastIndex !== -1) {
        pendingMessages = userMessages.slice(lastIndex + 1);
      } else {
        pendingMessages = userMessages.slice(-limit);
      }
    } else {
      pendingMessages = userMessages.slice(-limit);
    }

    await activityLoggerService.log({
      type: 'event',
      category: 'orchestrator',
      summary: `Retrieved ${pendingMessages.length} pending user messages`,
      details: {
        messageCount: pendingMessages.length,
        messages: pendingMessages.map(m => ({
          from: m.from,
          text: m.text.slice(0, 200),
          timestamp: m.timestamp,
        })),
      },
      correlationId,
    });

    // Add to conversation history so LLM can see the messages
    if (pendingMessages.length > 0) {
      this.conversationHistory.push({
        role: 'user',
        content: `New messages from user:\n${pendingMessages.map(m => `[${m.from}]: ${m.text}`).join('\n')}`,
      });
    } else {
      this.conversationHistory.push({
        role: 'user',
        content: 'No new messages from the user.',
      });
    }
  }

  /**
   * Tool: Get terminal output from an agent
   */
  private async toolGetAgentOutput(worktreeId: string, lines: number, correlationId: string): Promise<void> {
    const session = sessionPersistenceService.getSession(worktreeId);
    if (!session) {
      throw new Error(`No session found for worktree ${worktreeId}`);
    }

    // Get recent output from the terminal monitor
    const recentOutput = terminalMonitorService.getRecentOutput(session.id, lines);

    await activityLoggerService.log({
      type: 'event',
      category: 'agent',
      summary: `Retrieved output from ${worktreeId} (${recentOutput.length} chars)`,
      details: {
        worktreeId,
        sessionId: session.id,
        outputLength: recentOutput.length,
        output: recentOutput.slice(-2000), // Limit logged output
      },
      correlationId,
    });

    // Add to conversation history so LLM can see the output
    this.conversationHistory.push({
      role: 'user',
      content: `Terminal output from ${worktreeId}:\n\`\`\`\n${recentOutput.slice(-1000)}\n\`\`\``,
    });
  }

  /**
   * Tool: List all worktrees with status
   */
  private async toolListWorktrees(filter: string, correlationId: string): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const worktrees = await worktreeService.loadWorktreesForProject(projectId);
    const sessions = sessionPersistenceService.getSessionsForProject(projectId);
    const sessionByWorktree = new Map(sessions.map(s => [s.worktreeId, s]));

    // Filter worktrees based on filter parameter
    let filtered = worktrees.filter(w => !w.isMain);
    switch (filter) {
      case 'active':
        filtered = filtered.filter(w => !w.archived && !w.merged);
        break;
      case 'merged':
        filtered = filtered.filter(w => w.merged);
        break;
      case 'archived':
        filtered = filtered.filter(w => w.archived);
        break;
      // 'all' - no additional filtering
    }

    const worktreeInfo = filtered.map(w => {
      const session = sessionByWorktree.get(w.id);
      return {
        id: w.id,
        branch: w.branch,
        path: w.path,
        merged: w.merged || false,
        archived: w.archived || false,
        hasSession: !!session,
        sessionId: session?.id,
        lastCommit: w.lastCommitMessage,
        lastCommitDate: w.lastCommitDate,
        status: w.status,
      };
    });

    await activityLoggerService.log({
      type: 'event',
      category: 'orchestrator',
      summary: `Listed ${worktreeInfo.length} worktrees (filter: ${filter})`,
      details: { filter, worktrees: worktreeInfo },
      correlationId,
    });

    // Add to conversation history
    const summary = worktreeInfo.map(w => {
      const status = w.archived ? 'ARCHIVED' : w.merged ? 'MERGED' : 'ACTIVE';
      const session = w.hasSession ? 'has session' : 'no session';
      return `- ${w.branch} (${w.id.slice(0, 8)}): ${status}, ${session}`;
    }).join('\n');

    this.conversationHistory.push({
      role: 'user',
      content: `Worktrees (${filter}):\n${summary || 'No worktrees found'}`,
    });
  }

  /**
   * Tool: Archive a worktree
   */
  private async toolArchiveWorktree(worktreeId: string, correlationId: string): Promise<void> {
    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) throw new Error('Worktree not found');

    // Archive the worktree
    await worktreeService.archiveWorktree(worktreeId);

    await activityLoggerService.log({
      type: 'action',
      category: 'worktree',
      summary: `Archived worktree ${worktree.branch}`,
      details: { worktreeId, branch: worktree.branch },
      correlationId,
    });

    this.emit('worktree:archived', { worktreeId, branch: worktree.branch });
  }

  /**
   * Tool: Nudge an agent by sending enter presses
   */
  private async toolNudgeAgent(worktreeId: string, correlationId: string): Promise<void> {
    const session = sessionPersistenceService.getSession(worktreeId);
    if (!session) {
      throw new Error(`No session found for worktree ${worktreeId}`);
    }

    // Send enter press to wake up the agent
    daemonClient.writeToSession(session.id, '\r');

    // Send another after a short delay
    setTimeout(() => {
      daemonClient.writeToSession(session.id, '\r');
    }, 500);

    await activityLoggerService.log({
      type: 'action',
      category: 'agent',
      summary: `Nudged agent in ${worktreeId}`,
      details: { worktreeId, sessionId: session.id },
      correlationId,
    });
  }

  /**
   * Tool: Get project file tree
   */
  private async toolGetFileTree(depth: number, correlationId: string): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project?.path) throw new Error('Project path not found');

    // Build file tree using fs
    const { readdirSync, statSync } = await import('node:fs');

    const buildTree = (dir: string, currentDepth: number, prefix: string = ''): string[] => {
      if (currentDepth > depth) return [];

      const entries: string[] = [];
      try {
        const items = readdirSync(dir);
        const filtered = items.filter(item =>
          !item.startsWith('.') &&
          !['node_modules', 'dist', 'build', '.git', '.worktrees'].includes(item)
        );

        for (let i = 0; i < filtered.length; i++) {
          const item = filtered[i];
          const fullPath = join(dir, item);
          const isLast = i === filtered.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          const nextPrefix = prefix + (isLast ? '    ' : '│   ');

          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
              entries.push(`${prefix}${connector}${item}/`);
              entries.push(...buildTree(fullPath, currentDepth + 1, nextPrefix));
            } else {
              entries.push(`${prefix}${connector}${item}`);
            }
          } catch {
            // Skip inaccessible files
          }
        }
      } catch {
        // Skip inaccessible directories
      }
      return entries;
    };

    const tree = buildTree(project.path, 1);
    const treeStr = tree.slice(0, 100).join('\n'); // Limit output

    await activityLoggerService.log({
      type: 'event',
      category: 'orchestrator',
      summary: `Retrieved file tree (depth: ${depth})`,
      details: { depth, lineCount: tree.length },
      correlationId,
    });

    // Add to conversation history
    this.conversationHistory.push({
      role: 'user',
      content: `Project file tree:\n\`\`\`\n${treeStr}\n${tree.length > 100 ? '... (truncated)' : ''}\`\`\``,
    });
  }

  /**
   * Tool: Get the merge queue
   */
  private async toolGetMergeQueue(correlationId: string): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project?.path) throw new Error('Project path not found');

    const queue = databaseService.getMergeQueue(project.path);

    await activityLoggerService.log({
      type: 'event',
      category: 'orchestrator',
      summary: `Retrieved merge queue (${queue.length} items)`,
      details: { queueSize: queue.length, queue },
      correlationId,
    });

    // Add to conversation history
    if (queue.length > 0) {
      const queueList = queue.map(item =>
        `- ${item.branch} (${item.worktreeId.slice(0, 8)}): ${item.summary || 'No summary'} [hasCommits: ${item.hasCommits}]`
      ).join('\n');
      this.conversationHistory.push({
        role: 'user',
        content: `Merge queue (${queue.length} items waiting):\n${queueList}`,
      });
    } else {
      this.conversationHistory.push({
        role: 'user',
        content: 'Merge queue is empty - no branches waiting to be merged.',
      });
    }
  }

  /**
   * Tool: Merge a worktree from the merge queue
   */
  private async toolMergeFromQueue(worktreeId: string, correlationId: string): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project?.path) throw new Error('Project path not found');

    // Check if the worktree is in the merge queue
    const entry = databaseService.getMergeQueueEntry(project.path, worktreeId);
    if (!entry) {
      throw new Error(`Worktree ${worktreeId} is not in the merge queue`);
    }

    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) throw new Error('Worktree not found');

    await this.logToTextFile(`Merging ${worktree.branch} from queue...`);

    // Use git commands directly
    const { execSync } = await import('node:child_process');

    try {
      // Merge the branch into master from the main worktree
      execSync(`git merge ${worktree.branch} --no-edit`, {
        cwd: project.path,
        encoding: 'utf-8',
      });

      await this.logToTextFile(`Merged ${worktree.branch} successfully`);

      // Mark as merged in the queue
      databaseService.markMergeQueueEntryMerged(project.path, worktreeId);

      // Mark worktree as merged
      await worktreeService.markAsMerged(worktreeId);

      await activityLoggerService.log({
        type: 'action',
        category: 'worktree',
        summary: `Merged ${entry.branch} from queue`,
        details: { worktreeId, branch: entry.branch, summary: entry.summary },
        correlationId,
      });

      this.emit('worktree:merged', { worktreeId, branch: entry.branch });
    } catch (error: any) {
      await this.logToTextFile(`ERROR merging from queue: ${error.message}`);
      throw error;
    }
  }

  /**
   * Tool: Remove a worktree from the merge queue without merging
   */
  private async toolRemoveFromQueue(worktreeId: string, correlationId: string): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project?.path) throw new Error('Project path not found');

    const entry = databaseService.getMergeQueueEntry(project.path, worktreeId);
    if (!entry) {
      throw new Error(`Worktree ${worktreeId} is not in the merge queue`);
    }

    const success = databaseService.removeFromMergeQueue(project.path, worktreeId);
    if (!success) {
      throw new Error(`Failed to remove ${worktreeId} from merge queue`);
    }

    await activityLoggerService.log({
      type: 'action',
      category: 'orchestrator',
      summary: `Removed ${entry.branch} from merge queue`,
      details: { worktreeId, branch: entry.branch },
      correlationId,
    });

    await this.logToTextFile(`Removed ${entry.branch} from merge queue`);
  }

  /**
   * Get pending user messages from chat.json (messages after lastProcessedMessageId)
   */
  private async getPendingUserMessages(): Promise<Array<{ id: string; text: string; timestamp: string; from: string }>> {
    const projectId = this.projectId;
    if (!projectId) return [];

    const project = projectService.getProject(projectId);
    if (!project?.path) return [];

    const chatPath = join(project.path, '.orchard', 'chat.json');
    let messages: Array<{ id: string; text: string; timestamp: string; from: string }> = [];

    try {
      if (existsSync(chatPath)) {
        const data = await readFile(chatPath, 'utf-8');
        messages = JSON.parse(data);
      }
    } catch {
      return [];
    }

    // Only get user messages (not orchestrator messages)
    const userMessages = messages.filter(m => m.from === 'user');

    // If we have a lastProcessedMessageId, only return messages after it
    if (this.lastProcessedMessageId) {
      const lastIndex = userMessages.findIndex(m => m.id === this.lastProcessedMessageId);
      if (lastIndex !== -1) {
        return userMessages.slice(lastIndex + 1);
      }
    }

    return userMessages;
  }

  /**
   * Mark messages as processed (up to and including the given message ID)
   */
  private async markMessagesProcessed(messageId: string): Promise<void> {
    this.lastProcessedMessageId = messageId;
    await this.saveLastProcessedMessageId();
    console.log(`[OrchestratorLoop] Marked messages processed up to ${messageId}`);
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

    // Get pending user messages from chat.json (not messageQueueService)
    const pendingMessages = await this.getPendingUserMessages();

    // Get pending completions/questions/errors and clear them
    const completions = [...this.pendingCompletions];
    const questions = [...this.pendingQuestions];
    const errors = [...this.pendingErrors];
    this.pendingCompletions = [];
    this.pendingQuestions = [];
    this.pendingErrors = [];

    // Get merge queue
    let mergeQueue: MergeQueueItem[] = [];
    const project = projectService.getProject(projectId);
    if (project?.path) {
      const queueEntries = databaseService.getMergeQueue(project.path);
      mergeQueue = queueEntries.map(entry => ({
        worktreeId: entry.worktreeId,
        branch: entry.branch,
        completedAt: entry.completedAt,
        summary: entry.summary,
        hasCommits: entry.hasCommits,
      }));
    }

    return {
      timestamp: new Date(),
      tickNumber: this.tickNumber,
      pendingUserMessages: pendingMessages.length,
      activeAgents,
      deadSessions: deadWorktreeIds,
      completions,
      questions,
      errors,
      mergeQueue,
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
