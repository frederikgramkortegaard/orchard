#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { reportCompletion, ReportCompletionArgs } from './tools/report-completion.js';
import { askQuestion, AskQuestionArgs } from './tools/ask-question.js';
import { reportProgress, ReportProgressArgs } from './tools/report-progress.js';
import { reportError, ReportErrorArgs } from './tools/report-error.js';

// Orchard server base URL (configurable via env)
const ORCHARD_API = process.env.ORCHARD_API || 'http://localhost:3001';
// Worktree ID from env (set when Claude is launched in a worktree)
const WORKTREE_ID = process.env.WORKTREE_ID || '';

// Helper to inject worktreeId from env if not provided
function withWorktreeId<T extends { worktreeId?: string }>(args: T): T & { worktreeId: string } {
  return {
    ...args,
    worktreeId: args.worktreeId || WORKTREE_ID,
  };
}

// Tool definitions
const tools: Tool[] = [
  {
    name: 'report_completion',
    description: 'Report task completion to the orchestrator. Use this when you have finished the assigned task.',
    inputSchema: {
      type: 'object',
      properties: {
        worktreeId: {
          type: 'string',
          description: 'The worktree ID (auto-injected from environment, usually not needed)',
        },
        summary: {
          type: 'string',
          description: 'Brief summary of what was completed',
        },
        details: {
          type: 'string',
          description: 'Detailed description of the changes made (optional)',
        },
      },
      required: ['summary'],
    },
  },
  {
    name: 'ask_question',
    description: 'Ask the orchestrator a question when you need clarification or guidance',
    inputSchema: {
      type: 'object',
      properties: {
        worktreeId: {
          type: 'string',
          description: 'The worktree ID (auto-injected from environment, usually not needed)',
        },
        question: {
          type: 'string',
          description: 'The question to ask the orchestrator',
        },
        context: {
          type: 'string',
          description: 'Additional context for the question (optional)',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Possible answer options if applicable (optional)',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'report_progress',
    description: 'Report progress update to the orchestrator. Use this to keep the orchestrator informed of your progress.',
    inputSchema: {
      type: 'object',
      properties: {
        worktreeId: {
          type: 'string',
          description: 'The worktree ID (auto-injected from environment, usually not needed)',
        },
        status: {
          type: 'string',
          description: 'Current status message',
        },
        percentComplete: {
          type: 'number',
          description: 'Percentage of task completed (0-100)',
          minimum: 0,
          maximum: 100,
        },
        currentStep: {
          type: 'string',
          description: 'Description of the current step being worked on',
        },
        details: {
          type: 'string',
          description: 'Additional details about progress (optional)',
        },
      },
      required: ['status'],
    },
  },
  {
    name: 'report_error',
    description: 'Report an error or blocker to the orchestrator. Use this when you encounter issues that prevent progress.',
    inputSchema: {
      type: 'object',
      properties: {
        worktreeId: {
          type: 'string',
          description: 'The worktree ID (auto-injected from environment, usually not needed)',
        },
        error: {
          type: 'string',
          description: 'Description of the error or blocker',
        },
        severity: {
          type: 'string',
          enum: ['warning', 'error', 'blocker'],
          description: 'Severity level (default: error)',
        },
        context: {
          type: 'string',
          description: 'Context in which the error occurred',
        },
        suggestedAction: {
          type: 'string',
          description: 'Suggested action to resolve the issue',
        },
      },
      required: ['error'],
    },
  },
];

// Tool handlers - automatically inject worktreeId from env if not provided
const toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
  report_completion: async (args) => reportCompletion(ORCHARD_API, withWorktreeId(args as unknown as ReportCompletionArgs)),
  ask_question: async (args) => askQuestion(ORCHARD_API, withWorktreeId(args as unknown as AskQuestionArgs)),
  report_progress: async (args) => reportProgress(ORCHARD_API, withWorktreeId(args as unknown as ReportProgressArgs)),
  report_error: async (args) => reportError(ORCHARD_API, withWorktreeId(args as unknown as ReportErrorArgs)),
};

// Create and configure server
const server = new Server(
  {
    name: 'orchard-agent',
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
  console.error('Orchard MCP Agent running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
