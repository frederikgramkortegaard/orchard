import type { FastifyInstance } from 'fastify';
import { daemonClient } from '../pty/daemon-client.js';

export async function terminalsRoutes(fastify: FastifyInstance) {
  // Create terminal session
  fastify.post<{
    Body: { worktreeId: string; projectPath: string; cwd: string; initialCommand?: string };
  }>('/terminals', async (request, reply) => {
    const { worktreeId, projectPath, cwd, initialCommand } = request.body;

    if (!worktreeId || !projectPath || !cwd) {
      return reply.status(400).send({ error: 'worktreeId, projectPath, and cwd are required' });
    }

    if (!daemonClient.isConnected()) {
      return reply.status(503).send({ error: 'Terminal daemon not available' });
    }

    try {
      const sessionId = await daemonClient.createSession(worktreeId, projectPath, cwd, initialCommand);
      const session = await daemonClient.getSession(sessionId);

      return {
        id: sessionId,
        worktreeId,
        projectPath,
        cwd,
        createdAt: session?.createdAt || new Date().toISOString(),
      };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // List terminal sessions
  fastify.get('/terminals', async (request, reply) => {
    if (!daemonClient.isConnected()) {
      return reply.status(503).send({ error: 'Terminal daemon not available' });
    }

    try {
      const sessions = await daemonClient.listSessions();
      return sessions;
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Get terminal session
  fastify.get<{ Params: { id: string } }>('/terminals/:id', async (request, reply) => {
    if (!daemonClient.isConnected()) {
      return reply.status(503).send({ error: 'Terminal daemon not available' });
    }

    const session = await daemonClient.getSession(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return session;
  });

  // Delete terminal session
  fastify.delete<{ Params: { id: string } }>('/terminals/:id', async (request, reply) => {
    if (!daemonClient.isConnected()) {
      return reply.status(503).send({ error: 'Terminal daemon not available' });
    }

    const success = await daemonClient.destroySession(request.params.id);
    if (!success) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return { success: true };
  });

  // Send input to terminal session (for orchestrator to communicate with worktree agents)
  fastify.post<{
    Params: { id: string };
    Body: { input: string; sendEnter?: boolean };
  }>('/terminals/:id/input', async (request, reply) => {
    const { input, sendEnter = true } = request.body;

    if (!daemonClient.isConnected()) {
      return reply.status(503).send({ error: 'Terminal daemon not available' });
    }

    const session = await daemonClient.getSession(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    // Write the input to the terminal
    let data = input;
    if (sendEnter) {
      data += '\r'; // Add carriage return to simulate Enter key
    }

    daemonClient.writeToSession(request.params.id, data);

    return { success: true, sessionId: request.params.id };
  });

  // Get terminals by worktree ID
  fastify.get<{ Params: { worktreeId: string } }>(
    '/terminals/worktree/:worktreeId',
    async (request, reply) => {
      if (!daemonClient.isConnected()) {
        return reply.status(503).send({ error: 'Terminal daemon not available' });
      }

      try {
        const sessions = await daemonClient.getSessionsForWorktree(request.params.worktreeId);
        return sessions;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // Health check for daemon connection
  fastify.get('/terminals/health', async () => {
    return {
      daemonConnected: daemonClient.isConnected(),
    };
  });
}
