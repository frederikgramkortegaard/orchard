import type { FastifyInstance } from 'fastify';
import { orchestratorService } from '../services/orchestrator.service.js';

export async function orchestratorRoutes(fastify: FastifyInstance) {
  // Create orchestrator session for a project
  fastify.post<{
    Body: { projectId: string };
  }>('/orchestrator', async (request, reply) => {
    const { projectId } = request.body;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId is required' });
    }

    // Check if session already exists
    const existing = orchestratorService.getSessionForProject(projectId);
    if (existing) {
      return existing;
    }

    try {
      const session = await orchestratorService.createSession(projectId);
      return session;
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Get orchestrator session for a project
  fastify.get<{
    Params: { projectId: string };
  }>('/orchestrator/:projectId', async (request, reply) => {
    const session = orchestratorService.getSessionForProject(request.params.projectId);
    if (!session) {
      return reply.status(404).send({ error: 'Orchestrator session not found' });
    }
    return session;
  });

  // Execute orchestrator command
  fastify.post<{
    Params: { projectId: string };
    Body: { type: string; args?: Record<string, string> };
  }>('/orchestrator/:projectId/command', async (request, reply) => {
    const session = orchestratorService.getSessionForProject(request.params.projectId);
    if (!session) {
      return reply.status(404).send({ error: 'Orchestrator session not found' });
    }

    const { type, args = {} } = request.body;

    try {
      const result = await orchestratorService.executeCommand(session.id, {
        type: type as any,
        args,
      });
      return JSON.parse(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Destroy orchestrator session
  fastify.delete<{
    Params: { projectId: string };
  }>('/orchestrator/:projectId', async (request, reply) => {
    const session = orchestratorService.getSessionForProject(request.params.projectId);
    if (!session) {
      return reply.status(404).send({ error: 'Orchestrator session not found' });
    }

    orchestratorService.destroySession(session.id);
    return { success: true };
  });

  // Quick action: Create feature
  fastify.post<{
    Body: { projectId: string; name: string; description?: string };
  }>('/orchestrator/create-feature', async (request, reply) => {
    const { projectId, name, description } = request.body;

    if (!projectId || !name) {
      return reply.status(400).send({ error: 'projectId and name are required' });
    }

    // Ensure orchestrator session exists
    let session = orchestratorService.getSessionForProject(projectId);
    if (!session) {
      session = await orchestratorService.createSession(projectId);
    }

    try {
      const result = await orchestratorService.executeCommand(session.id, {
        type: 'create-feature',
        args: { name, description: description || '' },
      });
      return JSON.parse(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Quick action: Merge branches
  fastify.post<{
    Body: { projectId: string; source: string; target?: string };
  }>('/orchestrator/merge', async (request, reply) => {
    const { projectId, source, target } = request.body;

    if (!projectId || !source) {
      return reply.status(400).send({ error: 'projectId and source are required' });
    }

    let session = orchestratorService.getSessionForProject(projectId);
    if (!session) {
      session = await orchestratorService.createSession(projectId);
    }

    try {
      const result = await orchestratorService.executeCommand(session.id, {
        type: 'merge',
        args: { source, target: target || 'main' },
      });
      return JSON.parse(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Send prompt to a worktree's Claude session
  // This allows the orchestrator to communicate with other agents
  fastify.post<{
    Params: { projectId: string };
    Body: { worktreeId: string; prompt: string };
  }>('/orchestrator/:projectId/send-prompt', async (request, reply) => {
    const { worktreeId, prompt } = request.body;

    if (!worktreeId || !prompt) {
      return reply.status(400).send({ error: 'worktreeId and prompt are required' });
    }

    const success = await orchestratorService.sendPromptToWorktree(worktreeId, prompt);
    if (!success) {
      return reply.status(404).send({ error: 'No active session found for worktree' });
    }

    return { success: true, worktreeId, promptSent: true };
  });

  // List active worktree sessions that can receive prompts
  fastify.get<{
    Params: { projectId: string };
  }>('/orchestrator/:projectId/sessions', async (request) => {
    const sessions = orchestratorService.getActiveWorktreeSessions(request.params.projectId);
    return { sessions };
  });

  // Get recent task completions
  fastify.get('/orchestrator/completions', async () => {
    return { completions: orchestratorService.getRecentCompletions() };
  });

  // Clear completions (after processing them)
  fastify.delete('/orchestrator/completions', async () => {
    orchestratorService.clearCompletions();
    return { success: true };
  });
}
