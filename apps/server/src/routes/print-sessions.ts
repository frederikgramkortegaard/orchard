import type { FastifyInstance } from 'fastify';
import { databaseService } from '../services/database.service.js';
import { projectService } from '../services/project.service.js';
import { worktreeService } from '../services/worktree.service.js';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

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

    const project = projectService.getProject(worktree.projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const sessionId = randomUUID();

    // Create session record
    databaseService.createPrintSession(project.path, {
      id: sessionId,
      worktreeId,
      projectId: worktree.projectId,
      task,
    });

    // Escape task for shell
    const escapedTask = task.replace(/'/g, "'\\''");

    // Spawn claude -p via shell for proper output capture
    const claude = spawn('sh', ['-c', `claude -p '${escapedTask}' --dangerously-skip-permissions 2>&1`], {
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

    // Stream stdout to SQLite
    claude.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      console.log(`[PrintSessions] stdout (${sessionId}): ${text.substring(0, 100)}`);
      databaseService.appendTerminalOutput(project.path, sessionId, text);
    });

    // Stream stderr to SQLite
    claude.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      console.log(`[PrintSessions] stderr (${sessionId}): ${text.substring(0, 100)}`);
      databaseService.appendTerminalOutput(project.path, sessionId, text);
    });

    // Handle completion
    claude.on('close', (code) => {
      console.log(`[PrintSessions] Session ${sessionId} closed with code ${code}`);
      databaseService.completePrintSession(project.path, sessionId, code ?? 1);
    });

    claude.on('error', (err) => {
      console.error(`[PrintSessions] Error for session ${sessionId}:`, err);
      databaseService.appendTerminalOutput(project.path, sessionId, `\nError: ${err.message}\n`);
      databaseService.completePrintSession(project.path, sessionId, 1);
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
