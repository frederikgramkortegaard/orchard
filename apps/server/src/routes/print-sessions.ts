import type { FastifyInstance } from 'fastify';
import { databaseService } from '../services/database.service.js';
import { projectService } from '../services/project.service.js';
import { worktreeService } from '../services/worktree.service.js';
import { spawn, execSync, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Check if a worktree has commits since the task started (on its branch vs main)
 */
async function hasCommitsSinceStart(worktreePath: string, projectId: string): Promise<boolean> {
  try {
    const defaultBranch = await worktreeService.getDefaultBranch(projectId);
    // Check if there are any commits on this branch that aren't on the default branch
    const result = execSync(`git log ${defaultBranch}..HEAD --oneline`, {
      cwd: worktreePath,
      encoding: 'utf-8',
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

// Track running tasks per worktree to prevent concurrent tasks
// Maps worktreeId -> { sessionId, process, startedAt }
const runningTasks = new Map<string, { sessionId: string; process: ChildProcess; startedAt: Date }>();

// Helper to check if a worktree has a running task
function hasRunningTask(worktreeId: string): { running: boolean; sessionId?: string; startedAt?: Date } {
  const task = runningTasks.get(worktreeId);
  if (task) {
    return { running: true, sessionId: task.sessionId, startedAt: task.startedAt };
  }
  return { running: false };
}

// Helper to register a running task
function registerRunningTask(worktreeId: string, sessionId: string, process: ChildProcess): void {
  runningTasks.set(worktreeId, { sessionId, process, startedAt: new Date() });
}

// Helper to clear a running task
function clearRunningTask(worktreeId: string): void {
  runningTasks.delete(worktreeId);
}

// MCP tools prompt to inject into every agent task
const MCP_AGENT_PROMPT = `
## Important Guidelines

1. **Commit often**: After making changes, commit them with clear commit messages. Don't wait until the end.
2. **Report completion**: When done, call mcp__orchard-agent__report_completion with a summary.

## MCP Agent Tools

You have access to MCP tools for communicating with the orchestrator:

- **mcp__orchard-agent__report_completion**: Call this when you finish your task. Include a summary and details.
- **mcp__orchard-agent__log_activity**: Log significant actions (file_edit, command, commit, progress).
- **mcp__orchard-agent__report_progress**: Report progress updates with status and percentage.
- **mcp__orchard-agent__report_error**: Report errors or blockers that prevent progress.
- **mcp__orchard-agent__ask_question**: Ask the orchestrator for clarification if needed.

---

## Your Task

`;

export async function printSessionsRoutes(fastify: FastifyInstance) {
  // Create a new print session (runs claude -p)
  fastify.post<{
    Body: {
      worktreeId: string;
      task: string;
    };
  }>('/print-sessions', async (request, reply) => {
    const { worktreeId, task } = request.body;

    if (!worktreeId || !task) {
      return reply.status(400).send({ error: 'worktreeId and task required' });
    }

    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    // Check if worktree already has a running task
    const existing = hasRunningTask(worktreeId);
    if (existing.running) {
      return reply.status(409).send({
        error: 'Worktree already has a running task',
        sessionId: existing.sessionId,
        startedAt: existing.startedAt?.toISOString(),
      });
    }

    const project = projectService.getProject(worktree.projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const sessionId = randomUUID();

    // Create .mcp.json in worktree for agent MCP tools
    const mcpConfig = {
      mcpServers: {
        'orchard-agent': {
          command: 'node',
          args: [join(project.path, 'packages/mcp-agent/dist/index.js')],
          env: {
            ORCHARD_API: process.env.ORCHARD_API || 'http://localhost:3001',
            WORKTREE_ID: worktreeId,
          },
        },
      },
    };
    try {
      writeFileSync(join(worktree.path, '.mcp.json'), JSON.stringify(mcpConfig, null, 2));
    } catch (err) {
      console.error(`[PrintSessions] Failed to write .mcp.json:`, err);
    }

    // Build full prompt with MCP instructions
    const fullPrompt = MCP_AGENT_PROMPT + task;

    // Create session record
    databaseService.createPrintSession(project.path, {
      id: sessionId,
      worktreeId,
      projectId: worktree.projectId,
      task,
    });

    // Store the prompt header in terminal output so UI can display it
    databaseService.appendTerminalOutput(project.path, sessionId, `@@PROMPT@@\n${task}\n@@END@@\n`);

    // Escape full prompt for shell
    const escapedTask = fullPrompt.replace(/'/g, "'\\''");

    // Spawn claude -p with stream-json output format to capture tool results
    const claude = spawn('sh', ['-c', `claude -p '${escapedTask}' --dangerously-skip-permissions --verbose --output-format stream-json 2>&1`], {
      cwd: worktree.path,
      env: {
        ...process.env,
        WORKTREE_ID: worktreeId,
        TERM: 'dumb', // Disable terminal formatting
        NO_COLOR: '1', // Disable colors
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    console.log(`[PrintSessions] Started claude -p for session ${sessionId}, pid: ${claude.pid}`);

    // Register this task as running for the worktree
    registerRunningTask(worktreeId, sessionId, claude);

    // Buffer for incomplete JSON lines
    let lineBuffer = '';

    // Track current tool for associating results
    let currentTool: { name: string; id: string } | null = null;

    // Parse stream-json format and extract relevant output
    // Output format uses markers: @@TOOL:name@@, @@CMD:command@@, @@FILE:path@@, @@OUTPUT@@, @@END@@, @@TEXT@@
    const parseStreamJson = (text: string) => {
      lineBuffer += text;
      const lines = lineBuffer.split('\n');
      // Keep the last incomplete line in the buffer
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          // Handle different event types
          if (event.type === 'assistant' && event.message?.content) {
            // Assistant text response
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text?.trim()) {
                // Claude's thinking/response text
                databaseService.appendTerminalOutput(project.path, sessionId, `@@TEXT@@\n${block.text}\n@@END@@\n`);
              } else if (block.type === 'tool_use') {
                // Track current tool for result association
                currentTool = { name: block.name || 'unknown', id: block.id || '' };
                const input = block.input || {};

                if (block.name === 'Bash' && input.command) {
                  databaseService.appendTerminalOutput(project.path, sessionId,
                    `@@TOOL:Bash@@\n@@CMD:${input.command}@@\n`
                  );
                } else if (block.name === 'Write') {
                  databaseService.appendTerminalOutput(project.path, sessionId,
                    `@@TOOL:Write@@\n@@FILE:${input.file_path || ''}@@\n`
                  );
                } else if (block.name === 'Edit') {
                  databaseService.appendTerminalOutput(project.path, sessionId,
                    `@@TOOL:Edit@@\n@@FILE:${input.file_path || ''}@@\n`
                  );
                } else if (block.name === 'Read') {
                  databaseService.appendTerminalOutput(project.path, sessionId,
                    `@@TOOL:Read@@\n@@FILE:${input.file_path || ''}@@\n`
                  );
                } else if (block.name === 'Glob' || block.name === 'Grep') {
                  databaseService.appendTerminalOutput(project.path, sessionId,
                    `@@TOOL:${block.name}@@\n@@CMD:${input.pattern || ''}@@\n`
                  );
                } else if (block.name === 'WebSearch') {
                  databaseService.appendTerminalOutput(project.path, sessionId,
                    `@@TOOL:WebSearch@@\n@@CMD:${input.query || ''}@@\n`
                  );
                } else if (block.name === 'WebFetch') {
                  databaseService.appendTerminalOutput(project.path, sessionId,
                    `@@TOOL:WebFetch@@\n@@CMD:${input.url || ''}@@\n`
                  );
                } else if (block.name === 'Task') {
                  databaseService.appendTerminalOutput(project.path, sessionId,
                    `@@TOOL:Task@@\n@@CMD:${input.description || input.prompt?.slice(0, 100) || ''}@@\n`
                  );
                } else {
                  // Other tools
                  databaseService.appendTerminalOutput(project.path, sessionId,
                    `@@TOOL:${block.name}@@\n`
                  );
                }
              }
            }
          } else if (event.type === 'result') {
            // Tool result
            let resultText = '';
            if (typeof event.result === 'string') {
              resultText = event.result;
            } else if (event.result?.stdout) {
              resultText = event.result.stdout;
              if (event.result.stderr) {
                resultText += `\n@@STDERR@@\n${event.result.stderr}`;
              }
            } else if (event.result?.output) {
              resultText = event.result.output;
            } else if (event.result?.content) {
              // For Read tool results
              resultText = typeof event.result.content === 'string'
                ? event.result.content.slice(0, 500) + (event.result.content.length > 500 ? '\n... (truncated)' : '')
                : JSON.stringify(event.result.content).slice(0, 500);
            }

            if (resultText) {
              databaseService.appendTerminalOutput(project.path, sessionId,
                `@@OUTPUT@@\n${resultText}\n@@END@@\n`
              );
            }
            currentTool = null;
          } else if (event.type === 'content_block_delta' && event.delta?.text) {
            // Streaming text delta (for long responses)
            databaseService.appendTerminalOutput(project.path, sessionId, event.delta.text);
          }
        } catch {
          // Not valid JSON or parsing error - could be raw output
          if (line.trim()) {
            console.log(`[PrintSessions] Non-JSON line: ${line.substring(0, 50)}`);
          }
        }
      }
    };

    // Stream stdout (stream-json events)
    claude.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      console.log(`[PrintSessions] stdout (${sessionId}): ${text.substring(0, 100)}`);
      parseStreamJson(text);
    });

    // Stream stderr to SQLite (errors)
    claude.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      console.log(`[PrintSessions] stderr (${sessionId}): ${text.substring(0, 100)}`);
      databaseService.appendTerminalOutput(project.path, sessionId, `[stderr] ${text}`);
    });

    // Handle completion
    claude.on('close', async (code) => {
      console.log(`[PrintSessions] Session ${sessionId} closed with code ${code}`);
      databaseService.completePrintSession(project.path, sessionId, code ?? 1);

      // Clear the running task flag for this worktree
      clearRunningTask(worktreeId);

      // If task completed successfully (exit code 0), check for commits and add to merge queue
      if (code === 0) {
        try {
          const hasCommits = await hasCommitsSinceStart(worktree.path, worktree.projectId);
          if (hasCommits) {
            console.log(`[PrintSessions] Adding ${worktreeId} to merge queue (has commits)`);
            databaseService.addToMergeQueue(project.path, {
              worktreeId,
              branch: worktree.branch,
              summary: '', // Will be updated if agent called report_completion
              hasCommits: true,
            });
          } else {
            console.log(`[PrintSessions] Skipping merge queue for ${worktreeId} (no commits)`);
          }
        } catch (err) {
          console.error(`[PrintSessions] Error checking commits for ${worktreeId}:`, err);
        }
      }
    });

    claude.on('error', (err) => {
      console.error(`[PrintSessions] Error for session ${sessionId}:`, err);
      databaseService.appendTerminalOutput(project.path, sessionId, `\nError: ${err.message}\n`);
      databaseService.completePrintSession(project.path, sessionId, 1);
      // Clear the running task flag for this worktree
      clearRunningTask(worktreeId);
    });

    return {
      id: sessionId,
      worktreeId,
      projectId: worktree.projectId,
      task,
      status: 'running',
    };
  });

  // Get print session by ID
  fastify.get<{
    Params: { sessionId: string };
    Querystring: { projectId: string };
  }>('/print-sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId query param required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const session = databaseService.getPrintSession(project.path, sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return session;
  });

  // Get print sessions for a worktree
  fastify.get<{
    Querystring: { worktreeId: string; projectId: string };
  }>('/print-sessions', async (request, reply) => {
    const { worktreeId, projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId query param required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    if (worktreeId) {
      return databaseService.getPrintSessionsForWorktree(project.path, worktreeId);
    }

    // Return all sessions for project (could add this method if needed)
    return [];
  });

  // Get terminal output for a session (supports polling with afterId)
  fastify.get<{
    Params: { sessionId: string };
    Querystring: { projectId: string; afterId?: string };
  }>('/print-sessions/:sessionId/output', async (request, reply) => {
    const { sessionId } = request.params;
    const { projectId, afterId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId query param required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const session = databaseService.getPrintSession(project.path, sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const chunks = databaseService.getTerminalOutput(
      project.path,
      sessionId,
      afterId ? parseInt(afterId, 10) : undefined
    );

    return {
      sessionId,
      status: session.status,
      chunks,
      lastId: chunks.length > 0 ? chunks[chunks.length - 1].id : (afterId ? parseInt(afterId, 10) : 0),
    };
  });

  // Get full output as text
  fastify.get<{
    Params: { sessionId: string };
    Querystring: { projectId: string };
  }>('/print-sessions/:sessionId/output/full', async (request, reply) => {
    const { sessionId } = request.params;
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId query param required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const session = databaseService.getPrintSession(project.path, sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const output = databaseService.getFullTerminalOutput(project.path, sessionId);

    return {
      sessionId,
      status: session.status,
      exitCode: session.exitCode,
      output,
    };
  });
}
