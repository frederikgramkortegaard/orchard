import type { FastifyInstance } from 'fastify';
import { worktreeService } from '../services/worktree.service.js';
import { daemonClient } from '../pty/daemon-client.js';

export async function worktreesRoutes(fastify: FastifyInstance) {
  // List worktrees for a project
  fastify.get<{ Querystring: { projectId: string } }>('/worktrees', async (request, reply) => {
    const { projectId } = request.query;
    if (!projectId) {
      return reply.status(400).send({ error: 'projectId query parameter required' });
    }
    return await worktreeService.loadWorktreesForProject(projectId);
  });

  // Create worktree
  fastify.post<{
    Body: { projectId: string; branch: string; newBranch?: boolean; baseBranch?: string };
  }>('/worktrees', async (request, reply) => {
    const { projectId, branch, newBranch, baseBranch } = request.body;

    if (!projectId || !branch) {
      return reply.status(400).send({ error: 'projectId and branch required' });
    }

    try {
      const worktree = await worktreeService.createWorktree(projectId, branch, {
        newBranch,
        baseBranch,
      });

      // Auto-spawn a Claude session for this worktree (with skip-permissions since inside project)
      if (daemonClient.isConnected()) {
        try {
          await daemonClient.createSession(worktree.id, worktree.path, 'claude --dangerously-skip-permissions');
          console.log(`Created Claude session for worktree ${worktree.id}`);
        } catch (err) {
          console.error('Failed to create Claude session for worktree:', err);
          // Don't fail the worktree creation if session fails
        }
      }

      return worktree;
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Get worktree by ID
  fastify.get<{ Params: { id: string } }>('/worktrees/:id', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }
    return worktree;
  });

  // Delete worktree
  fastify.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/worktrees/:id',
    async (request, reply) => {
      const force = request.query.force === 'true';
      try {
        const success = await worktreeService.deleteWorktree(request.params.id, force);
        if (!success) {
          return reply.status(404).send({ error: 'Worktree not found' });
        }
        return { success: true };
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  // Get branches for a project
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/branches',
    async (request) => {
      return await worktreeService.getBranches(request.params.projectId);
    }
  );

  // Refresh worktree status
  fastify.post<{ Params: { id: string } }>('/worktrees/:id/refresh', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }
    const status = await worktreeService.getWorktreeStatus(worktree.path);
    return { ...worktree, status };
  });

  // Ensure a Claude session exists for a worktree (creates one if not)
  fastify.post<{ Params: { id: string } }>('/worktrees/:id/ensure-session', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    if (!daemonClient.isConnected()) {
      return reply.status(503).send({ error: 'Terminal daemon not available' });
    }

    // Check if session already exists for this worktree
    const existingSessions = await daemonClient.getSessionsForWorktree(worktree.id);
    if (existingSessions.length > 0) {
      return { session: existingSessions[0], created: false };
    }

    // Create new Claude session with skip-permissions since worktree is inside project
    try {
      const sessionId = await daemonClient.createSession(worktree.id, worktree.path, 'claude --dangerously-skip-permissions');
      const session = await daemonClient.getSession(sessionId);
      console.log(`Created Claude session ${sessionId} for worktree ${worktree.id}`);
      return {
        session: {
          id: sessionId,
          worktreeId: worktree.id,
          cwd: worktree.path,
          createdAt: session?.createdAt || new Date().toISOString(),
        },
        created: true
      };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
