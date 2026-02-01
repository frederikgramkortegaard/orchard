import type { FastifyInstance } from 'fastify';
import { daemonClient } from '../pty/daemon-client.js';

/**
 * Check daemon connection and circuit breaker status.
 * Returns an error response object if unavailable, or null if OK.
 */
function checkDaemonAvailability(): { status: number; error: string; circuitState?: string } | null {
  const circuitState = daemonClient.getCircuitState();

  if (circuitState === 'open') {
    return {
      status: 503,
      error: 'Terminal daemon circuit breaker is open - service temporarily unavailable',
      circuitState,
    };
  }

  if (!daemonClient.isConnected()) {
    return {
      status: 503,
      error: 'Terminal daemon not available',
      circuitState,
    };
  }

  return null;
}

export async function terminalsRoutes(fastify: FastifyInstance) {
  // Create terminal session
  fastify.post<{
    Body: { worktreeId: string; projectPath: string; cwd: string; initialCommand?: string };
  }>('/terminals', async (request, reply) => {
    const { worktreeId, projectPath, cwd, initialCommand } = request.body;

    if (!worktreeId || !projectPath || !cwd) {
      return reply.status(400).send({ error: 'worktreeId, projectPath, and cwd are required' });
    }

    const unavailable = checkDaemonAvailability();
    if (unavailable) {
      return reply.status(unavailable.status).send({
        error: unavailable.error,
        circuitState: unavailable.circuitState,
      });
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
      // Provide more context on circuit breaker related errors
      if (err.message.includes('circuit breaker')) {
        return reply.status(503).send({
          error: err.message,
          circuitState: daemonClient.getCircuitState(),
        });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // List terminal sessions (optionally filtered by worktreeId)
  fastify.get<{ Querystring: { worktreeId?: string } }>('/terminals', async (request, reply) => {
    const unavailable = checkDaemonAvailability();
    if (unavailable) {
      return reply.status(unavailable.status).send({
        error: unavailable.error,
        circuitState: unavailable.circuitState,
      });
    }

    try {
      const { worktreeId } = request.query;
      let sessions = await daemonClient.listSessions();

      if (worktreeId) {
        sessions = sessions.filter((s: any) => s.worktreeId === worktreeId);
      }

      return sessions;
    } catch (err: any) {
      if (err.message.includes('circuit breaker')) {
        return reply.status(503).send({
          error: err.message,
          circuitState: daemonClient.getCircuitState(),
        });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // Get terminal session
  fastify.get<{ Params: { id: string } }>('/terminals/:id', async (request, reply) => {
    const unavailable = checkDaemonAvailability();
    if (unavailable) {
      return reply.status(unavailable.status).send({
        error: unavailable.error,
        circuitState: unavailable.circuitState,
      });
    }

    try {
      const session = await daemonClient.getSession(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      return session;
    } catch (err: any) {
      if (err.message.includes('circuit breaker')) {
        return reply.status(503).send({
          error: err.message,
          circuitState: daemonClient.getCircuitState(),
        });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // Delete terminal session
  fastify.delete<{ Params: { id: string } }>('/terminals/:id', async (request, reply) => {
    const unavailable = checkDaemonAvailability();
    if (unavailable) {
      return reply.status(unavailable.status).send({
        error: unavailable.error,
        circuitState: unavailable.circuitState,
      });
    }

    try {
      const success = await daemonClient.destroySession(request.params.id);
      if (!success) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      return { success: true };
    } catch (err: any) {
      if (err.message.includes('circuit breaker')) {
        return reply.status(503).send({
          error: err.message,
          circuitState: daemonClient.getCircuitState(),
        });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // Send input to terminal session (for orchestrator to communicate with worktree agents)
  fastify.post<{
    Params: { id: string };
    Body: { input: string; sendEnter?: boolean };
  }>('/terminals/:id/input', async (request, reply) => {
    const { input, sendEnter = true } = request.body;

    const unavailable = checkDaemonAvailability();
    if (unavailable) {
      return reply.status(unavailable.status).send({
        error: unavailable.error,
        circuitState: unavailable.circuitState,
      });
    }

    try {
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
    } catch (err: any) {
      if (err.message.includes('circuit breaker')) {
        return reply.status(503).send({
          error: err.message,
          circuitState: daemonClient.getCircuitState(),
        });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // Get terminals by worktree ID (with optional path fallback for orphaned sessions)
  fastify.get<{ Params: { worktreeId: string }; Querystring: { path?: string } }>(
    '/terminals/worktree/:worktreeId',
    async (request, reply) => {
      const unavailable = checkDaemonAvailability();
      if (unavailable) {
        return reply.status(unavailable.status).send({
          error: unavailable.error,
          circuitState: unavailable.circuitState,
        });
      }

      try {
        const { worktreeId } = request.params;
        const { path } = request.query;
        const sessions = await daemonClient.getSessionsForWorktree(worktreeId, path);
        return sessions;
      } catch (err: any) {
        if (err.message.includes('circuit breaker')) {
          return reply.status(503).send({
            error: err.message,
            circuitState: daemonClient.getCircuitState(),
          });
        }
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // Health check for daemon connection with circuit breaker status
  fastify.get('/terminals/health', async () => {
    const circuitStats = daemonClient.getCircuitStats();
    return {
      daemonConnected: daemonClient.isConnected(),
      circuitBreaker: circuitStats,
    };
  });
}
