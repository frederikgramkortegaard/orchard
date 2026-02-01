// @ts-nocheck
// TODO: Fix OpenAI types and activityLoggerService types
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import OpenAI from 'openai';
import { activityLoggerService } from './activity-logger.service.js';
import { worktreeService } from './worktree.service.js';
import { orchestratorService } from './orchestrator.service.js';
import { projectService } from './project.service.js';
import { databaseService } from './database.service.js';
import { debugLogService } from './debug-log.service.js';

// Placeholder type for compatibility
type DetectedPattern = {
  worktreeId: string;
  sessionId: string;
  type: string;
  timestamp: Date;
  content?: string;
};

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
  language: string;
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

export interface InterruptedSession {
  sessionId: string;
  worktreeId: string;
  task: string;
}

export interface TickContext {
  timestamp: Date;
  tickNumber: number;
  pendingUserMessages: number;
  activeAgents: AgentStatus[];
  deadSessions: string[];
  interruptedSessions: InterruptedSession[];
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
  tickIntervalMs: 5000, // 5 seconds max (fallback, normally uses smart timing)
  maxConsecutiveFailures: 3,
  autoRestartDeadSessions: true,
  language: 'English',
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
      name: 'read_file',
      description: 'Read the contents of a file. Useful for quick lookups without spawning an agent. Limited to 500 lines by default.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The file path relative to the project root (e.g., "src/index.ts", "package.json")',
          },
          maxLines: {
            type: 'number',
            description: 'Maximum number of lines to return (default: 500)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in a directory or match a glob pattern. Useful for exploring the codebase without spawning an agent.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to project root (default: ".")',
          },
          pattern: {
            type: 'string',
            description: 'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.js")',
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
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Get git status showing modified, staged, and untracked files. Can check main worktree or a specific worktree.',
      parameters: {
        type: 'object',
        properties: {
          worktreeId: {
            type: 'string',
            description: 'Optional: specific worktree ID to check. If omitted, checks the main worktree.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: 'Get recent commit history. Shows commit hash, author, date, and message.',
      parameters: {
        type: 'object',
        properties: {
          worktreeId: {
            type: 'string',
            description: 'Optional: specific worktree ID to check. If omitted, checks the main worktree.',
          },
          count: {
            type: 'number',
            description: 'Number of commits to show (default: 10, max: 50)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Show uncommitted changes (diff of working directory vs HEAD). Useful for reviewing what an agent has changed.',
      parameters: {
        type: 'object',
        properties: {
          worktreeId: {
            type: 'string',
            description: 'Optional: specific worktree ID to check. If omitted, checks the main worktree.',
          },
          staged: {
            type: 'boolean',
            description: 'If true, show staged changes only. If false (default), show unstaged changes.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_branches',
      description: 'List all branches in the repository with their last commit info.',
      parameters: {
        type: 'object',
        properties: {
          showRemote: {
            type: 'boolean',
            description: 'Include remote branches (default: false)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resume_session',
      description: 'Resume an interrupted Claude agent session. Use this when a session was interrupted (exit -1) and needs to continue its work.',
      parameters: {
        type: 'object',
        properties: {
          worktreeId: {
            type: 'string',
            description: 'The ID of the worktree with the interrupted session',
          },
        },
        required: ['worktreeId'],
      },
    },
  },
];

const BASE_SYSTEM_PROMPT = `Orchard orchestrator. Manage Claude agents in git worktrees, delegate user requests, merge completed work.

RULES:
- no_action when pendingUserMessages=0 AND no completions/questions/errors
- Always use FULL worktree UUIDs (never truncate)
- read_file/list_files for quick code lookups (faster than spawning agents)
- Merge flow: merge_from_queue (auto-handles conflicts, auto-archives on success)
- Dead sessions auto-restart, no action needed
- Interrupted sessions (exit -1): use resume_session

STYLE: Concise. "Starting agent." not "Let me create a worktree to handle your request..."`;

function getSystemPrompt(language: string): string {
  return `${BASE_SYSTEM_PROMPT}

LANGUAGE: Always respond in ${language}. All messages to the user must be in ${language}.`;
}

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
   * Mark all current messages as processed (for "clear pending" feature)
   */
  async markAllMessagesProcessed(projectIdOverride?: string): Promise<void> {
    const projectId = projectIdOverride || this.projectId;
    if (!projectId) {
      console.error('[OrchestratorLoop] markAllMessagesProcessed: No project ID - orchestrator loop not started?');
      return;
    }

    const project = projectService.getProject(projectId);
    if (!project?.path) {
      console.error(`[OrchestratorLoop] markAllMessagesProcessed: Project ${projectId} not found`);
      return;
    }

    // Mark all unprocessed user messages as processed in SQLite
    const count = databaseService.markChatMessagesProcessed(project.path, projectId);
    console.log(`[OrchestratorLoop] Marked ${count} pending messages as processed for project ${projectId}`);
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
      timeout: 60000, // 60 second timeout
    });
    console.log(`[OrchestratorLoop] Initialized OpenAI client for ${this.config.provider} at ${this.config.baseUrl}`);
  }

  /**
   * Initialize the loop - must be called before start
   */
  async initialize(): Promise<void> {
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

      // Schedule first tick
      this.scheduleNextTick();

      this.state = LoopState.RUNNING;
      this.emit('state:change', this.state);

      console.log(`[OrchestratorLoop] Started for project ${this.projectId} using ${this.config.model}`);
      debugLogService.info('orchestrator', `Loop started for project ${this.projectId}`, {
        model: this.config.model,
        provider: this.config.provider,
        tickIntervalMs: this.config.tickIntervalMs,
      });
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
    debugLogService.info('orchestrator', 'Loop stopped', {
      tickNumber: this.tickNumber,
      consecutiveFailures: this.consecutiveFailures,
    });
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
      const startTime = Date.now();

      // Get pending messages BEFORE gathering context (so we can mark them processed after)
      const pendingMessages = await this.getPendingUserMessages();

      // Gather tick context
      context = await this.gatherTickContext();

      const contextTime = Date.now() - startTime;
      if (contextTime > 1000) {
        await this.logToTextFile(`[TICK #${this.tickNumber}] Context gathered in ${contextTime}ms (slow!)`);
      }

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
                      context.interruptedSessions.length > 0 ||
                      context.mergeQueue.length > 0;

      if (!hasWork) {
        await this.logToTextFile(`[TICK #${this.tickNumber}] Nothing to do - skipping LLM call`);
        this.lastActionWasNoAction = true;
      } else {
        // Limit conversation history to avoid context pollution but keep some context
        // Keep last 10 messages for context, discard older ones
        if (this.conversationHistory.length > 10) {
          this.conversationHistory = this.conversationHistory.slice(-10);
          debugLogService.debug('orchestrator', 'Trimmed conversation history to last 10 messages', { correlationId });
        }

        // Call LLM for decisions - returns true if a real action was taken (not no_action)
        tookAction = await this.callLLMForDecisions(context, correlationId);
        this.lastActionWasNoAction = !tookAction;
      }

      // Mark pending messages as processed after LLM has seen them
      // This prevents the same messages from triggering responses every tick
      if (pendingMessages.length > 0) {
        const messageIds = pendingMessages.map(m => m.id);
        await this.markMessagesProcessed(messageIds);
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
        interruptedSessions: [],
        completions: [],
        questions: [],
        errors: [],
        mergeQueue: [],
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
      { role: 'system' as const, content: getSystemPrompt(this.config.language) },
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

    // Log to debug panel
    debugLogService.logAIRequest({
      tickNumber: context.tickNumber,
      model: this.config.model,
      provider: this.config.provider,
      messages: fullMessages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
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

      // Log to debug panel
      debugLogService.logAIResponse({
        tickNumber: context.tickNumber,
        model: this.config.model,
        provider: this.config.provider,
        content: assistantMessage?.content || undefined,
        toolCalls: assistantMessage?.tool_calls?.map(tc => ({
          name: tc.function.name,
          arguments: tc.function.arguments,
        })),
        usage: response.usage ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        } : undefined,
        finishReason: response.choices[0]?.finish_reason || undefined,
        correlationId,
      });

      if (!assistantMessage) {
        console.log('[OrchestratorLoop] No response from LLM');
        await this.logToTextFile(`  ERROR: No response from LLM`);
        return false;
      }

      // Log response to text file
      const toolCalls = assistantMessage.tool_calls || [];
      const toolSummary = toolCalls.map(tc => {
        const args = JSON.parse(tc.function.arguments || '{}');
        return `${tc.function.name}(${Object.entries(args).map(([k,v]) => `${k}=${JSON.stringify(v)?.slice(0,50)}`).join(', ')})`;
      }).join(', ') || 'none';
      if (assistantMessage.content) {
        await this.logToTextFile(`  Thinking: ${assistantMessage.content.slice(0, 200)}`);
      }
      await this.logToTextFile(`  Action: ${toolSummary}`);

      // Add assistant response to history
      this.conversationHistory.push(assistantMessage);

      // If LLM returned text content, automatically send it to the chat
      // This ensures the user sees any response, not just tool calls
      if (assistantMessage.content && assistantMessage.content.trim()) {
        const project = projectService.getProject(this.projectId!);
        if (project?.path) {
          databaseService.addChatMessage(project.path, {
            id: randomUUID(),
            projectId: this.projectId!,
            from: 'orchestrator',
            text: assistantMessage.content,
          });
          debugLogService.debug('orchestrator', 'Auto-sent LLM response to chat', {
            content: assistantMessage.content.slice(0, 100),
            correlationId,
          });
        }
      }

      // Execute tool calls and track if any real action was taken
      let tookRealAction = false;
      let calledNoAction = false;
      const toolResults: string[] = [];

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const isNoAction = toolName === 'no_action';

          if (isNoAction) {
            calledNoAction = true;
          } else {
            tookRealAction = true;
          }

          const result = await this.executeToolCall(toolCall, correlationId);
          toolResults.push(`${toolCall.function.name}: ${result}`);
          debugLogService.debug('orchestrator', `Tool result: ${toolName}`, { result: result.slice(0, 200), correlationId });
        }

        // Add tool results to conversation history so LLM can see success/failure
        if (toolResults.length > 0) {
          const hasErrors = toolResults.some(r => r.includes('ERROR'));
          this.conversationHistory.push({
            role: 'user',
            content: `Tool execution results:\n${toolResults.join('\n')}${hasErrors ? '\n\nPlease inform the user about the error and try to fix it if possible.' : ''}`,
          });

          // Continue the conversation until LLM calls no_action or makes no tool calls
          // This allows the LLM to take multiple actions in response to user messages
          if (!calledNoAction) {
            debugLogService.debug('orchestrator', 'Continuing conversation...', { correlationId });
            // High safety limit (20 turns) to prevent infinite loops
            const continuedAction = await this.continueLLMConversation(correlationId, 20);
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
      debugLogService.error('orchestrator', `LLM call failed: ${error.message}`, {
        error: error.stack,
        correlationId,
      });
      debugLogService.logAIResponse({
        tickNumber: context.tickNumber,
        model: this.config.model,
        error: error.message,
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
      { role: 'system' as const, content: getSystemPrompt(this.config.language) },
      ...this.conversationHistory,
    ];

    // Log the continuation request to SQLite
    debugLogService.logAIRequest({
      tickNumber: this.tickNumber,
      model: this.config.model,
      provider: this.config.provider,
      messages: fullMessages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      correlationId: `${correlationId}-continue`,
    });

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: fullMessages,
        tools: ORCHESTRATOR_TOOLS,
        tool_choice: 'auto',
      });

      const assistantMessage = response.choices[0]?.message;
      if (!assistantMessage) {
        debugLogService.warn('orchestrator', 'Continuation: No response from LLM', { correlationId });
        return false;
      }

      // Log the continuation response to SQLite
      debugLogService.logAIResponse({
        tickNumber: this.tickNumber,
        model: this.config.model,
        provider: this.config.provider,
        content: assistantMessage.content || undefined,
        toolCalls: assistantMessage.tool_calls?.map(tc => ({
          name: tc.function.name,
          arguments: tc.function.arguments,
        })),
        usage: response.usage ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        } : undefined,
        finishReason: response.choices[0]?.finish_reason || undefined,
        correlationId: `${correlationId}-continue`,
      });

      debugLogService.debug('orchestrator', `Continuation response: ${assistantMessage.content?.slice(0, 100) || '(no text)'}`, {
        tools: assistantMessage.tool_calls?.map(tc => tc.function.name) || [],
        correlationId,
      });

      this.conversationHistory.push(assistantMessage);

      // Auto-send LLM text content to chat
      if (assistantMessage.content && assistantMessage.content.trim()) {
        const project = projectService.getProject(this.projectId!);
        if (project?.path) {
          databaseService.addChatMessage(project.path, {
            id: randomUUID(),
            projectId: this.projectId!,
            from: 'orchestrator',
            text: assistantMessage.content,
          });
        }
      }

      let tookAction = false;
      let calledNoAction = false;

      // If no tool calls, LLM is done
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        debugLogService.debug('orchestrator', 'Continuation complete: no tool calls', { correlationId });
        return false;
      }

      const toolResults: string[] = [];

      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        const isNoAction = toolName === 'no_action';

        if (isNoAction) {
          calledNoAction = true;
        } else {
          tookAction = true;
        }

        const result = await this.executeToolCall(toolCall, correlationId);
        toolResults.push(`${toolCall.function.name}: ${result}`);
        debugLogService.debug('orchestrator', `Continuation tool: ${toolName}`, { result: result.slice(0, 200), correlationId });
      }

      // If LLM called no_action, it's signaling it's done
      if (calledNoAction) {
        debugLogService.debug('orchestrator', 'Continuation complete: no_action called', { correlationId });
        return tookAction;
      }

      // Add tool results and continue
      if (toolResults.length > 0) {
        this.conversationHistory.push({
          role: 'user',
          content: `Tool results:\n${toolResults.join('\n')}`,
        });

        // Continue until LLM decides it's done (calls no_action or makes no tool calls)
        const continued = await this.continueLLMConversation(correlationId, maxTurns - 1);
        return tookAction || continued;
      }

      return tookAction;
    } catch (error: any) {
      debugLogService.error('orchestrator', `Continuation error: ${error.message}`, { error: error.stack, correlationId });
      return false;
    }
  }

  /**
   * Format the tick context as a message for the LLM
   */
  private formatTickMessage(context: TickContext): string {
    const lines: string[] = [
      `[TICK #${context.tickNumber} | ${context.timestamp.toISOString()}]`,
    ];

    // Pending user messages - show prominently at the top
    if (context.pendingUserMessages > 0) {
      lines.push('');
      lines.push(`⚠️ NEW USER MESSAGE(S): ${context.pendingUserMessages} pending`);
      lines.push('→ Call get_user_messages to read and respond to the NEW message(s)');
      lines.push('→ This may be a NEW question unrelated to previous topics');
    }

    lines.push('');
    lines.push('Current State:');

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

    // Interrupted sessions (need resume_session)
    if (context.interruptedSessions.length > 0) {
      lines.push(`- INTERRUPTED SESSIONS (use resume_session to continue):`);
      for (const s of context.interruptedSessions) {
        lines.push(`  - worktreeId: ${s.worktreeId} - Task: ${s.task}`);
      }
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
    debugLogService.debug('orchestrator', `Executing tool: ${name}`, { tool: name, arguments: args });

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
          return await this.toolGetUserMessages(args.limit || 10, correlationId);
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
        case 'read_file':
          return await this.toolReadFile(args.path, args.maxLines || 500, correlationId);
        case 'list_files':
          return await this.toolListFiles(args.path || '.', args.pattern, correlationId);
        case 'get_merge_queue':
          await this.toolGetMergeQueue(correlationId);
          return `SUCCESS: Retrieved merge queue`;
        case 'merge_from_queue':
          await this.toolMergeFromQueue(args.worktreeId, correlationId);
          return `SUCCESS: Merged ${args.worktreeId} from queue`;
        case 'remove_from_queue':
          await this.toolRemoveFromQueue(args.worktreeId, correlationId);
          return `SUCCESS: Removed ${args.worktreeId} from queue`;
        case 'git_status':
          return await this.toolGitStatus(args.worktreeId, correlationId);
        case 'git_log':
          return await this.toolGitLog(args.worktreeId, args.count || 10, correlationId);
        case 'git_diff':
          return await this.toolGitDiff(args.worktreeId, args.staged || false, correlationId);
        case 'git_branches':
          return await this.toolGitBranches(args.showRemote || false, correlationId);
        case 'resume_session':
          return await this.toolResumeSession(args.worktreeId, correlationId);
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

      await activityLoggerService.log({
        type: 'event',
        category: 'agent',
        summary: `Status check for ${worktreeId}`,
        details: {
          worktree: worktree ? { id: worktree.id, branch: worktree.branch } : null,
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
   * Returns the messages directly so the LLM can act on them
   */
  private async toolGetUserMessages(limit: number, correlationId: string): Promise<string> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project?.path) throw new Error('Project path not found');

    // Get unprocessed user messages from SQLite
    const pendingMessages = databaseService.getChatMessages(project.path, projectId, {
      unprocessedOnly: true,
      from: 'user',
      limit,
    });

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

    // Return the messages directly so LLM can see and act on them
    if (pendingMessages.length > 0) {
      const formattedMessages = pendingMessages
        .map(m => `[${m.timestamp}] ${m.text}`)
        .join('\n');
      return `User messages (${pendingMessages.length}):\n${formattedMessages}\n\nPlease respond to the user using send_message.`;
    } else {
      return 'No new messages from the user.';
    }
  }

  /**
   * Tool: Get terminal output from an agent (from print session SQLite)
   */
  private async toolGetAgentOutput(worktreeId: string, lines: number, correlationId: string): Promise<void> {
    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${worktreeId} not found`);
    }

    const project = projectService.getProject(worktree.projectId);
    if (!project) {
      throw new Error(`Project not found for worktree ${worktreeId}`);
    }

    // Get print sessions for this worktree
    const sessions = databaseService.getPrintSessionsForWorktree(project.path, worktreeId);
    if (sessions.length === 0) {
      throw new Error(`No print sessions found for worktree ${worktreeId}`);
    }

    // Get the most recent session
    const latestSession = sessions[0];

    // Get terminal output from SQLite
    const fullOutput = databaseService.getFullTerminalOutput(project.path, latestSession.id);

    // Get last N lines worth of output
    const outputLines = fullOutput.split('\n');
    const recentOutput = outputLines.slice(-lines).join('\n');

    await activityLoggerService.log({
      type: 'event',
      category: 'agent',
      summary: `Retrieved output from ${worktreeId} (${recentOutput.length} chars)`,
      details: {
        worktreeId,
        sessionId: latestSession.id,
        sessionStatus: latestSession.status,
        outputLength: recentOutput.length,
        output: recentOutput.slice(-2000),
      },
      correlationId,
    });

    // Add to conversation history so LLM can see the output
    this.conversationHistory.push({
      role: 'user',
      content: `Terminal output from ${worktreeId} (session: ${latestSession.status}):\n\`\`\`\n${recentOutput.slice(-1000)}\n\`\`\``,
    });
  }

  /**
   * Tool: List all worktrees with status
   */
  private async toolListWorktrees(filter: string, correlationId: string): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const worktrees = await worktreeService.loadWorktreesForProject(projectId);

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
      return {
        id: w.id,
        branch: w.branch,
        path: w.path,
        merged: w.merged || false,
        archived: w.archived || false,
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
   * Tool: Nudge an agent - not applicable for print sessions (one-shot)
   * Print sessions run `claude -p` which can't be nudged interactively.
   * If an agent is stuck, check its status or create a new session.
   */
  private async toolNudgeAgent(worktreeId: string, correlationId: string): Promise<void> {
    // Print sessions (claude -p) are one-shot and can't be nudged
    // This tool is kept for API compatibility but doesn't do anything useful

    await activityLoggerService.log({
      type: 'event',
      category: 'agent',
      summary: `Nudge requested for ${worktreeId} (not applicable for print sessions)`,
      details: { worktreeId, note: 'Print sessions are one-shot and cannot be nudged' },
      correlationId,
    });

    // Check if there's a running print session
    const worktree = worktreeService.getWorktree(worktreeId);
    if (worktree) {
      const project = projectService.getProject(worktree.projectId);
      if (project) {
        const sessions = databaseService.getPrintSessionsForWorktree(project.path, worktreeId);
        const runningSession = sessions.find(s => s.status === 'running');
        if (runningSession) {
          debugLogService.info('orchestrator', `Worktree ${worktreeId} has a running print session - nudge not applicable`, { correlationId });
        }
      }
    }
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
   * Tool: Read file contents
   * Returns the file contents (truncated to maxLines) for quick lookups without spawning an agent.
   */
  private async toolReadFile(filePath: string, maxLines: number, correlationId: string): Promise<string> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project?.path) throw new Error('Project path not found');

    // Resolve the path relative to project root
    const fullPath = join(project.path, filePath);

    // Security check: ensure the path is within the project
    const normalizedPath = join(fullPath);
    if (!normalizedPath.startsWith(project.path)) {
      throw new Error('Path must be within the project directory');
    }

    try {
      const content = await readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      const truncated = lines.length > maxLines;
      const resultLines = lines.slice(0, maxLines);
      const result = resultLines.join('\n');

      await activityLoggerService.log({
        type: 'event',
        category: 'orchestrator',
        summary: `Read file ${filePath} (${lines.length} lines${truncated ? ', truncated' : ''})`,
        details: { filePath, totalLines: lines.length, returnedLines: resultLines.length, truncated },
        correlationId,
      });

      // Add to conversation history so LLM can see the file contents
      this.conversationHistory.push({
        role: 'user',
        content: `Contents of ${filePath}:\n\`\`\`\n${result}\n${truncated ? `... (truncated, showing ${maxLines} of ${lines.length} lines)` : ''}\`\`\``,
      });

      return `SUCCESS: Read ${filePath} (${resultLines.length} lines${truncated ? `, truncated from ${lines.length}` : ''})`;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      if (error.code === 'EISDIR') {
        throw new Error(`Path is a directory, not a file: ${filePath}`);
      }
      throw error;
    }
  }

  /**
   * Tool: List files in a directory or match a glob pattern
   * Useful for exploring the codebase without spawning an agent.
   */
  private async toolListFiles(dirPath: string, pattern: string | undefined, correlationId: string): Promise<string> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project?.path) throw new Error('Project path not found');

    // Resolve the path relative to project root
    const fullPath = join(project.path, dirPath);

    // Security check: ensure the path is within the project
    const normalizedPath = join(fullPath);
    if (!normalizedPath.startsWith(project.path)) {
      throw new Error('Path must be within the project directory');
    }

    let files: string[] = [];

    if (pattern) {
      // Use glob to match files
      const { glob } = await import('glob');
      const globPattern = join(dirPath, pattern);
      const matches = await glob(globPattern, {
        cwd: project.path,
        nodir: false,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      });
      files = matches.slice(0, 100); // Limit results
    } else {
      // List directory contents
      const { readdirSync, statSync } = await import('node:fs');
      try {
        const items = readdirSync(fullPath);
        files = items
          .filter(item => !item.startsWith('.') && item !== 'node_modules')
          .slice(0, 100)
          .map(item => {
            try {
              const itemPath = join(fullPath, item);
              const stat = statSync(itemPath);
              return stat.isDirectory() ? `${item}/` : item;
            } catch {
              return item;
            }
          });
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          throw new Error(`Directory not found: ${dirPath}`);
        }
        if (error.code === 'ENOTDIR') {
          throw new Error(`Path is not a directory: ${dirPath}`);
        }
        throw error;
      }
    }

    await activityLoggerService.log({
      type: 'event',
      category: 'orchestrator',
      summary: `Listed files in ${dirPath}${pattern ? ` (pattern: ${pattern})` : ''} - ${files.length} results`,
      details: { dirPath, pattern, fileCount: files.length, files: files.slice(0, 20) },
      correlationId,
    });

    // Add to conversation history
    const fileList = files.join('\n');
    this.conversationHistory.push({
      role: 'user',
      content: `Files in ${dirPath}${pattern ? ` matching "${pattern}"` : ''}:\n\`\`\`\n${fileList}\n${files.length >= 100 ? '... (truncated to 100 results)' : ''}\`\`\``,
    });

    return `SUCCESS: Found ${files.length} files${pattern ? ` matching "${pattern}"` : ''} in ${dirPath}`;
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

      // Remove from merge queue
      databaseService.removeFromMergeQueue(project.path, worktreeId);

      // Archive the worktree after successful merge
      await worktreeService.archiveWorktree(worktreeId);

      await activityLoggerService.log({
        type: 'action',
        category: 'worktree',
        summary: `Merged and archived ${entry.branch}`,
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
   * Tool: Git status - show modified, staged, and untracked files
   */
  private async toolGitStatus(worktreeId: string | undefined, correlationId: string): Promise<string> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project?.path) throw new Error('Project path not found');

    let targetPath = project.path;
    let targetLabel = 'main worktree';

    if (worktreeId) {
      const worktree = worktreeService.getWorktree(worktreeId);
      if (!worktree) throw new Error(`Worktree ${worktreeId} not found`);
      targetPath = worktree.path;
      targetLabel = worktree.branch;
    }

    const { simpleGit } = await import('simple-git');
    const git = simpleGit(targetPath);
    const status = await git.status();

    const statusInfo = {
      branch: status.current,
      ahead: status.ahead,
      behind: status.behind,
      modified: status.modified,
      staged: status.staged,
      untracked: status.not_added,
      conflicted: status.conflicted,
    };

    await activityLoggerService.log({
      type: 'event',
      category: 'orchestrator',
      summary: `Git status for ${targetLabel}`,
      details: statusInfo,
      correlationId,
    });

    // Format for LLM
    const lines = [`Git status for ${targetLabel} (branch: ${status.current}):`];
    if (status.ahead > 0) lines.push(`  Ahead of remote by ${status.ahead} commits`);
    if (status.behind > 0) lines.push(`  Behind remote by ${status.behind} commits`);
    if (status.staged.length > 0) lines.push(`  Staged: ${status.staged.join(', ')}`);
    if (status.modified.length > 0) lines.push(`  Modified: ${status.modified.join(', ')}`);
    if (status.not_added.length > 0) lines.push(`  Untracked: ${status.not_added.join(', ')}`);
    if (status.conflicted.length > 0) lines.push(`  Conflicted: ${status.conflicted.join(', ')}`);
    if (status.staged.length === 0 && status.modified.length === 0 && status.not_added.length === 0) {
      lines.push('  Working tree clean');
    }

    this.conversationHistory.push({
      role: 'user',
      content: lines.join('\n'),
    });

    return `SUCCESS: Got git status for ${targetLabel}`;
  }

  /**
   * Tool: Git log - show recent commits
   */
  private async toolGitLog(worktreeId: string | undefined, count: number, correlationId: string): Promise<string> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project?.path) throw new Error('Project path not found');

    let targetPath = project.path;
    let targetLabel = 'main worktree';

    if (worktreeId) {
      const worktree = worktreeService.getWorktree(worktreeId);
      if (!worktree) throw new Error(`Worktree ${worktreeId} not found`);
      targetPath = worktree.path;
      targetLabel = worktree.branch;
    }

    // Cap count at 50
    const maxCount = Math.min(count, 50);

    const { simpleGit } = await import('simple-git');
    const git = simpleGit(targetPath);
    const log = await git.log({ maxCount });

    await activityLoggerService.log({
      type: 'event',
      category: 'orchestrator',
      summary: `Git log for ${targetLabel} (${log.total} commits)`,
      details: { count: maxCount, commits: log.all.slice(0, 5) },
      correlationId,
    });

    // Format for LLM
    const lines = [`Recent commits for ${targetLabel}:`];
    for (const commit of log.all) {
      const date = new Date(commit.date).toLocaleDateString();
      lines.push(`  ${commit.hash.slice(0, 7)} ${date} - ${commit.message.slice(0, 60)}`);
    }

    this.conversationHistory.push({
      role: 'user',
      content: lines.join('\n'),
    });

    return `SUCCESS: Got ${log.all.length} commits for ${targetLabel}`;
  }

  /**
   * Tool: Git diff - show uncommitted changes
   */
  private async toolGitDiff(worktreeId: string | undefined, staged: boolean, correlationId: string): Promise<string> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project?.path) throw new Error('Project path not found');

    let targetPath = project.path;
    let targetLabel = 'main worktree';

    if (worktreeId) {
      const worktree = worktreeService.getWorktree(worktreeId);
      if (!worktree) throw new Error(`Worktree ${worktreeId} not found`);
      targetPath = worktree.path;
      targetLabel = worktree.branch;
    }

    const { simpleGit } = await import('simple-git');
    const git = simpleGit(targetPath);

    let diff: string;
    if (staged) {
      diff = await git.diff(['--cached']);
    } else {
      diff = await git.diff();
    }

    // Truncate if too long
    const maxLength = 3000;
    const truncated = diff.length > maxLength;
    const displayDiff = truncated ? diff.slice(0, maxLength) + '\n... (truncated)' : diff;

    await activityLoggerService.log({
      type: 'event',
      category: 'orchestrator',
      summary: `Git diff for ${targetLabel} (${staged ? 'staged' : 'unstaged'}, ${diff.length} chars)`,
      details: { staged, length: diff.length, truncated },
      correlationId,
    });

    // Format for LLM
    const diffType = staged ? 'Staged changes' : 'Unstaged changes';
    const content = diff.length > 0
      ? `${diffType} in ${targetLabel}:\n\`\`\`diff\n${displayDiff}\n\`\`\``
      : `No ${staged ? 'staged' : 'unstaged'} changes in ${targetLabel}`;

    this.conversationHistory.push({
      role: 'user',
      content,
    });

    return `SUCCESS: Got ${staged ? 'staged' : 'unstaged'} diff for ${targetLabel} (${diff.length} chars)`;
  }

  /**
   * Tool: Git branches - list all branches
   */
  private async toolGitBranches(showRemote: boolean, correlationId: string): Promise<string> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project?.path) throw new Error('Project path not found');

    const { simpleGit } = await import('simple-git');
    const git = simpleGit(project.path);

    const branches = await git.branch(showRemote ? ['-a'] : []);

    await activityLoggerService.log({
      type: 'event',
      category: 'orchestrator',
      summary: `Git branches (${branches.all.length} total)`,
      details: { showRemote, current: branches.current, branches: branches.all.slice(0, 20) },
      correlationId,
    });

    // Format for LLM
    const lines = [`Git branches (current: ${branches.current}):`];
    for (const branch of branches.all.slice(0, 30)) {
      const isCurrent = branch === branches.current;
      lines.push(`  ${isCurrent ? '* ' : '  '}${branch}`);
    }
    if (branches.all.length > 30) {
      lines.push(`  ... and ${branches.all.length - 30} more`);
    }

    this.conversationHistory.push({
      role: 'user',
      content: lines.join('\n'),
    });

    return `SUCCESS: Listed ${branches.all.length} branches`;
  }

  /**
   * Resume an interrupted Claude agent session
   */
  private async toolResumeSession(worktreeId: string, correlationId: string): Promise<string> {
    const projectId = this.projectId;
    if (!projectId) throw new Error('No project context');

    const project = projectService.getProject(projectId);
    if (!project?.path) throw new Error('Project path not found');

    await activityLoggerService.log({
      type: 'action',
      category: 'orchestrator',
      summary: `Resuming session for worktree ${worktreeId}`,
      details: { worktreeId },
      correlationId,
    });

    try {
      // Use session persistence service to restore/resume the session
      const newSession = await sessionPersistenceService.restoreSession(project.path, worktreeId);

      if (newSession) {
        this.conversationHistory.push({
          role: 'user',
          content: `Session resumed for worktree ${worktreeId}. New session ID: ${newSession.sessionId}`,
        });
        return `SUCCESS: Resumed session for ${worktreeId}. Session ID: ${newSession.sessionId}`;
      } else {
        return `ERROR: Could not resume session for ${worktreeId} - no previous session found`;
      }
    } catch (error: any) {
      return `ERROR: Failed to resume session: ${error.message}`;
    }
  }

  /**
   * Get pending user messages from SQLite (unprocessed messages from users)
   */
  private async getPendingUserMessages(): Promise<Array<{ id: string; text: string; timestamp: string; from: string }>> {
    const projectId = this.projectId;
    if (!projectId) return [];

    const project = projectService.getProject(projectId);
    if (!project?.path) return [];

    // Get unprocessed user messages from SQLite
    const messages = databaseService.getChatMessages(project.path, projectId, {
      unprocessedOnly: true,
      from: 'user',
      limit: 50,
    });

    return messages.map(m => ({
      id: m.id,
      text: m.text,
      timestamp: m.timestamp,
      from: m.from,
    }));
  }

  /**
   * Mark messages as processed in SQLite
   */
  private async markMessagesProcessed(messageIds: string[]): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) return;

    const project = projectService.getProject(projectId);
    if (!project?.path) return;

    // Mark messages as processed in SQLite
    const count = databaseService.markChatMessagesProcessed(project.path, projectId, messageIds);
    console.log(`[OrchestratorLoop] Marked ${count} messages as processed`);
  }

  /**
   * Gather context for the tick
   */
  private async gatherTickContext(): Promise<TickContext> {
    const projectId = this.projectId || '';

    // Use lightweight worktree listing (no git status checks)
    const lightWorktrees = await worktreeService.listWorktreesLight(projectId);

    // Build agent status list - only include active (non-archived) agents
    const activeAgents: AgentStatus[] = lightWorktrees
      .filter(w => !w.archived)
      .map(w => {
        return {
          worktreeId: w.id,
          branch: w.branch,
          status: 'IDLE' as const,
          hasActiveSession: false,
          sessionId: undefined,
        };
      });

    // No dead sessions without terminal support
    const deadWorktreeIds: string[] = [];

    // Get pending user messages from chat.json (not messageQueueService)
    const pendingMessages = await this.getPendingUserMessages();

    // Get pending completions/questions/errors and clear them
    const completions = [...this.pendingCompletions];
    const questions = [...this.pendingQuestions];
    const errors = [...this.pendingErrors];
    this.pendingCompletions = [];
    this.pendingQuestions = [];
    this.pendingErrors = [];

    // Get merge queue and interrupted sessions
    let mergeQueue: MergeQueueItem[] = [];
    let interruptedSessions: InterruptedSession[] = [];
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

      // Get interrupted print sessions (exit code -1)
      const interrupted = databaseService.getInterruptedPrintSessions(project.path);
      interruptedSessions = interrupted.map(s => ({
        sessionId: s.id,
        worktreeId: s.worktreeId,
        task: s.task.slice(0, 100), // Truncate for context
      }));
    }

    return {
      timestamp: new Date(),
      tickNumber: this.tickNumber,
      pendingUserMessages: pendingMessages.length,
      activeAgents,
      deadSessions: deadWorktreeIds,
      interruptedSessions,
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
   * Restart dead sessions (no-op without terminal support)
   */
  private async restartDeadSessions(_worktreeIds: string[], _correlationId: string): Promise<void> {
    // Terminal session restart is no longer supported
  }

  /**
   * Send a message to a specific agent (no longer supported without terminal)
   */
  async sendToAgent(_worktreeId: string, _message: string): Promise<boolean> {
    // Terminal session messaging is no longer supported
    return false;
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
    if (!initialTask) {
      throw new Error('Task is required for agent session');
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Use HTTP API to create print session (runs claude -p)
    const response = await fetch(`http://localhost:3001/print-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worktreeId, task: initialTask }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create print session');
    }

    const result = await response.json();
    const sessionId = result.sessionId;

    console.log(`[OrchestratorLoop] Started claude -p session ${sessionId} for ${worktreeId}`);

    await activityLoggerService.log({
      type: 'action',
      category: 'agent',
      summary: `Created print session for ${worktreeId}`,
      details: { worktreeId, sessionId, task: initialTask.slice(0, 100) },
      correlationId: randomUUID(),
    });

    return sessionId;
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
