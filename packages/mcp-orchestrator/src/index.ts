#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { listAgents } from './tools/list-agents.js';
import { createAgent } from './tools/create-agent.js';
import { sendTask } from './tools/send-task.js';
import { getAgentStatus } from './tools/get-agent-status.js';
import { mergeBranch } from './tools/merge-branch.js';
import { getProjectStatus } from './tools/get-project-status.js';
import { getMessages } from './tools/get-messages.js';
import { sendMessage } from './tools/send-message.js';
import { archiveWorktree } from './tools/archive-worktree.js';
import { nudgeAgent } from './tools/nudge-agent.js';
import { getFileTree } from './tools/get-file-tree.js';
import { listSessions } from './tools/list-sessions.js';
import { startSession } from './tools/start-session.js';
import { stopSession } from './tools/stop-session.js';
import { restartSession } from './tools/restart-session.js';
import { runTask } from './tools/run-task.js';
import { updateMessageStatus } from './tools/update-message-status.js';
import { logActivity } from './tools/log-activity.js';

// Orchard server base URL (configurable via env)
const ORCHARD_API = process.env.ORCHARD_API || 'http://localhost:3001';

// Helper to log activity after tool execution
async function logToolActivity(
  projectId: string | undefined,
  activityType: 'orchestrator' | 'command' | 'task_complete',
  summary: string,
  details?: Record<string, unknown>
): Promise<void> {
  if (!projectId) return;
  try {
    await fetch(`${ORCHARD_API}/agent/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, activityType, summary, details }),
    });
  } catch {
    // Silently ignore logging failures - don't break the tool execution
  }
}

// Tool definitions
const tools: Tool[] = [
  {
    name: 'list_agents',
    description: 'List all coding agents (worktrees) and their status',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to list agents for',
        },
        filter: {
          type: 'string',
          enum: ['all', 'active', 'merged', 'archived'],
          description: 'Filter agents by status (default: all)',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'create_agent',
    description: 'Create a new coding agent in a git worktree to work on a task',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to create agent in',
        },
        name: {
          type: 'string',
          description: 'Name for the feature branch (e.g., "user-auth", "fix-bug-123")',
        },
        task: {
          type: 'string',
          description: 'The task description to give to the agent',
        },
        mode: {
          type: 'string',
          enum: ['normal', 'plan'],
          description: 'Agent mode: "normal" executes immediately, "plan" creates a plan and waits for approval before implementing (default: normal)',
        },
      },
      required: ['projectId', 'name', 'task'],
    },
  },
  {
    name: 'send_task',
    description: 'Send a task or message to an existing coding agent',
    inputSchema: {
      type: 'object',
      properties: {
        worktreeId: {
          type: 'string',
          description: 'The worktree/agent ID to send the task to',
        },
        message: {
          type: 'string',
          description: 'The task or message to send',
        },
      },
      required: ['worktreeId', 'message'],
    },
  },
  {
    name: 'get_agent_status',
    description: 'Get detailed status and recent output from a coding agent',
    inputSchema: {
      type: 'object',
      properties: {
        worktreeId: {
          type: 'string',
          description: 'The worktree/agent ID to check',
        },
        includeOutput: {
          type: 'boolean',
          description: 'Whether to include recent terminal output (default: true)',
        },
        outputLines: {
          type: 'number',
          description: 'Number of output lines to include (default: 50)',
        },
      },
      required: ['worktreeId'],
    },
  },
  {
    name: 'merge_branch',
    description: 'Merge a completed feature branch into main',
    inputSchema: {
      type: 'object',
      properties: {
        worktreeId: {
          type: 'string',
          description: 'The worktree/agent ID to merge',
        },
        deleteAfterMerge: {
          type: 'boolean',
          description: 'Whether to delete the worktree after merging (default: false)',
        },
      },
      required: ['worktreeId'],
    },
  },
  {
    name: 'get_project_status',
    description: 'Get overall project status including all agents, pending messages, and health',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to get status for',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_messages',
    description: 'Get recent chat messages from the user. Use this to check what the user has said. If no projectId is specified or allProjects is true, returns messages from ALL open projects grouped by project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to get messages for. If omitted, returns messages from all open projects.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages to retrieve per project (default: 20)',
        },
        allProjects: {
          type: 'boolean',
          description: 'If true, fetch messages from all open projects regardless of projectId',
        },
      },
      required: [],
    },
  },
  {
    name: 'send_message',
    description: 'Send a message to the activity log',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to send message to',
        },
        message: {
          type: 'string',
          description: 'The message to log',
        },
      },
      required: ['projectId', 'message'],
    },
  },
  {
    name: 'archive_worktree',
    description: 'Archive a completed worktree to clean it up',
    inputSchema: {
      type: 'object',
      properties: {
        worktreeId: {
          type: 'string',
          description: 'The worktree ID to archive',
        },
      },
      required: ['worktreeId'],
    },
  },
  {
    name: 'nudge_agent',
    description: 'Send enter presses to a stuck agent to wake it up',
    inputSchema: {
      type: 'object',
      properties: {
        worktreeId: {
          type: 'string',
          description: 'The worktree ID containing the agent to nudge',
        },
      },
      required: ['worktreeId'],
    },
  },
  {
    name: 'get_file_tree',
    description: 'Get the project directory structure',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to get file tree for',
        },
        depth: {
          type: 'number',
          description: 'How many levels deep to show (default: 2)',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'list_sessions',
    description: 'List all active terminal sessions',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to list sessions for',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'start_session',
    description: 'Start a Claude session for a worktree',
    inputSchema: {
      type: 'object',
      properties: {
        worktreeId: {
          type: 'string',
          description: 'The worktree ID to start a session for',
        },
        projectId: {
          type: 'string',
          description: 'Project ID',
        },
        task: {
          type: 'string',
          description: 'Optional task to run with claude -p. If not provided, starts interactive mode.',
        },
      },
      required: ['worktreeId', 'projectId'],
    },
  },
  {
    name: 'stop_session',
    description: 'Stop a terminal session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to stop',
        },
        projectId: {
          type: 'string',
          description: 'Project ID',
        },
      },
      required: ['sessionId', 'projectId'],
    },
  },
  {
    name: 'restart_session',
    description: 'Restart a Claude session for a worktree (stops existing, starts new)',
    inputSchema: {
      type: 'object',
      properties: {
        worktreeId: {
          type: 'string',
          description: 'The worktree ID to restart session for',
        },
        projectId: {
          type: 'string',
          description: 'Project ID',
        },
        task: {
          type: 'string',
          description: 'Optional task to send after Claude starts',
        },
      },
      required: ['worktreeId', 'projectId'],
    },
  },
  {
    name: 'run_task',
    description: 'Run a one-shot task using claude -p (print mode). More efficient than interactive sessions for quick tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        worktreeId: {
          type: 'string',
          description: 'The worktree ID to run the task in',
        },
        projectId: {
          type: 'string',
          description: 'Project ID',
        },
        task: {
          type: 'string',
          description: 'The task/prompt to execute',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 120000)',
        },
      },
      required: ['worktreeId', 'projectId', 'task'],
    },
  },
  {
    name: 'update_message_status',
    description: 'Update the status of a chat message to track progress',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The ID of the message to update',
        },
        status: {
          type: 'string',
          enum: ['unread', 'read', 'working', 'resolved'],
          description: 'The new status for the message',
        },
      },
      required: ['messageId', 'status'],
    },
  },
  {
    name: 'log_activity',
    description: 'Log an activity to the activity feed for visibility',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to log activity for',
        },
        activityType: {
          type: 'string',
          enum: ['file_edit', 'command', 'commit', 'task_complete', 'error', 'progress', 'orchestrator'],
          description: 'Type of activity being logged',
        },
        summary: {
          type: 'string',
          description: 'Brief description of the activity',
        },
        details: {
          type: 'object',
          description: 'Additional details about the activity (optional)',
        },
      },
      required: ['projectId', 'activityType', 'summary'],
    },
  },
];

// Tool handlers with automatic activity logging
const toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
  list_agents: async (args) => listAgents(ORCHARD_API, args as { projectId: string; filter?: string }),

  create_agent: async (args) => {
    const { projectId, name, task, mode } = args as { projectId: string; name: string; task: string; mode?: 'normal' | 'plan' };
    const result = await createAgent(ORCHARD_API, { projectId, name, task, mode });
    await logToolActivity(projectId, 'orchestrator', `Created agent: feature/${name}`, { task: task.slice(0, 100), mode });
    return result;
  },

  send_task: async (args) => sendTask(ORCHARD_API, args as { worktreeId: string; message: string }),
  get_agent_status: async (args) => getAgentStatus(ORCHARD_API, args as { worktreeId: string; includeOutput?: boolean; outputLines?: number }),

  merge_branch: async (args) => {
    const { worktreeId, deleteAfterMerge } = args as { worktreeId: string; deleteAfterMerge?: boolean };
    const result = await mergeBranch(ORCHARD_API, { worktreeId, deleteAfterMerge });
    // Extract projectId from result or use worktree lookup
    const match = result.match(/Merged .* into/);
    if (match) {
      // Try to get projectId - we'll need to fetch worktree info first
      try {
        const res = await fetch(`${ORCHARD_API}/worktrees/${worktreeId}`);
        if (res.ok) {
          const wt = await res.json();
          await logToolActivity(wt.projectId, 'orchestrator', `Merged branch: ${wt.branch}`, { worktreeId });
        }
      } catch { /* ignore */ }
    }
    return result;
  },

  get_project_status: async (args) => getProjectStatus(ORCHARD_API, args as { projectId: string }),
  get_messages: async (args) => getMessages(ORCHARD_API, args as { projectId?: string; limit?: number; allProjects?: boolean }),
  send_message: async (args) => sendMessage(ORCHARD_API, args as { projectId: string; message: string }),

  archive_worktree: async (args) => {
    const { worktreeId } = args as { worktreeId: string };
    // Get worktree info before archiving
    let projectId: string | undefined;
    let branch: string | undefined;
    try {
      const res = await fetch(`${ORCHARD_API}/worktrees/${worktreeId}`);
      if (res.ok) {
        const wt = await res.json();
        projectId = wt.projectId;
        branch = wt.branch;
      }
    } catch { /* ignore */ }
    const result = await archiveWorktree(ORCHARD_API, { worktreeId });
    if (projectId) {
      await logToolActivity(projectId, 'orchestrator', `Archived worktree: ${branch || worktreeId}`, { worktreeId });
    }
    return result;
  },

  nudge_agent: async (args) => nudgeAgent(ORCHARD_API, args as { worktreeId: string }),
  get_file_tree: async (args) => getFileTree(ORCHARD_API, args as { projectId: string; depth?: number }),
  list_sessions: async (args) => listSessions(ORCHARD_API, args as { projectId: string }),

  start_session: async (args) => {
    const { worktreeId, projectId, task } = args as { worktreeId: string; projectId: string; task?: string };
    const result = await startSession(ORCHARD_API, { worktreeId, projectId, task });
    await logToolActivity(projectId, 'orchestrator', `Started session for worktree`, { worktreeId, hasTask: !!task });
    return result;
  },

  stop_session: async (args) => {
    const { sessionId, projectId } = args as { sessionId: string; projectId: string };
    const result = await stopSession(ORCHARD_API, { sessionId, projectId });
    await logToolActivity(projectId, 'orchestrator', `Stopped session: ${sessionId.slice(0, 8)}`, { sessionId });
    return result;
  },

  restart_session: async (args) => {
    const { worktreeId, projectId, task } = args as { worktreeId: string; projectId: string; task?: string };
    const result = await restartSession(ORCHARD_API, { worktreeId, projectId, task });
    await logToolActivity(projectId, 'orchestrator', `Restarted session for worktree`, { worktreeId, hasTask: !!task });
    return result;
  },

  run_task: async (args) => {
    const { worktreeId, projectId, task, timeout } = args as { worktreeId: string; projectId: string; task: string; timeout?: number };
    await logToolActivity(projectId, 'orchestrator', `Running task: ${task.slice(0, 50)}...`, { worktreeId });
    const result = await runTask(ORCHARD_API, { worktreeId, projectId, task, timeout });
    return result;
  },

  update_message_status: async (args) => updateMessageStatus(ORCHARD_API, args as { messageId: string; status: 'unread' | 'read' | 'working' | 'resolved' }),
  log_activity: async (args) => logActivity(ORCHARD_API, args as { projectId: string; activityType: 'file_edit' | 'command' | 'commit' | 'task_complete' | 'error' | 'progress' | 'orchestrator'; summary: string; details?: Record<string, unknown> }),
};

// Create and configure server
const server = new Server(
  {
    name: 'orchard-orchestrator',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const handler = toolHandlers[name];
  if (!handler) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const result = await handler(args as Record<string, unknown>);
    return {
      content: [{ type: 'text', text: result }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Orchard MCP Orchestrator running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
