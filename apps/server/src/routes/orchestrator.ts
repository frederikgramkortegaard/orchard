import type { FastifyInstance } from 'fastify';
import { orchestratorService } from '../services/orchestrator.service.js';
import { worktreeService } from '../services/worktree.service.js';
import { orchestratorLoopService } from '../services/orchestrator-loop.service.js';

interface HealthAction {
  type: 'archive' | 'sync' | 'commit' | 'cleanup' | 'review';
  worktreeId: string;
  branch: string;
  priority: 'high' | 'medium' | 'low';
  description: string;
}

interface WorktreeHealth {
  id: string;
  branch: string;
  path: string;
  isMain: boolean;
  merged: boolean;
  archived: boolean;
  status: {
    ahead: number;
    behind: number;
    modified: number;
    staged: number;
    untracked: number;
  };
  hasActiveSession: boolean;
}

interface HealthCheckResponse {
  projectId: string;
  timestamp: string;
  worktrees: WorktreeHealth[];
  activeSessions: Array<{
    worktreeId: string;
    sessionId: string;
    branch: string;
  }>;
  archiveCandidates: Array<{
    worktreeId: string;
    branch: string;
    reason: string;
  }>;
  suggestedActions: HealthAction[];
  summary: {
    totalWorktrees: number;
    activeWorktrees: number;
    mergedWorktrees: number;
    archivedWorktrees: number;
    worktreesWithChanges: number;
  };
}

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

  // Consolidated health check endpoint
  fastify.get<{
    Params: { projectId: string };
  }>('/orchestrator/:projectId/health', async (request, reply) => {
    const { projectId } = request.params;

    // Load all worktrees for the project
    const worktrees = await worktreeService.loadWorktreesForProject(projectId);
    if (worktrees.length === 0) {
      return reply.status(404).send({ error: 'No worktrees found for project' });
    }

    // Get all active sessions for the project
    const activeSessions = await orchestratorService.getActiveWorktreeSessions(projectId);
    const activeWorktreeIds = new Set(activeSessions.map(s => s.worktreeId));

    // Build worktree health data
    const worktreeHealth: WorktreeHealth[] = worktrees.map(w => ({
      id: w.id,
      branch: w.branch,
      path: w.path,
      isMain: w.isMain,
      merged: w.merged,
      archived: w.archived,
      status: w.status,
      hasActiveSession: activeWorktreeIds.has(w.id),
    }));

    // Identify archive candidates
    const archiveCandidates: Array<{ worktreeId: string; branch: string; reason: string }> = [];
    for (const w of worktrees) {
      if (w.isMain || w.archived) continue;

      const hasSession = activeWorktreeIds.has(w.id);
      const hasChanges = w.status.modified > 0 || w.status.staged > 0 || w.status.untracked > 0;

      if (w.merged && !hasSession) {
        archiveCandidates.push({
          worktreeId: w.id,
          branch: w.branch,
          reason: 'Branch merged and no active session',
        });
      } else if (!hasSession && !hasChanges && w.status.ahead === 0) {
        // Idle worktree with no changes and nothing to push
        archiveCandidates.push({
          worktreeId: w.id,
          branch: w.branch,
          reason: 'Idle worktree with no pending changes',
        });
      }
    }

    // Generate suggested actions
    const suggestedActions: HealthAction[] = [];

    for (const w of worktrees) {
      if (w.isMain) continue;

      const hasSession = activeWorktreeIds.has(w.id);

      // Behind remote - needs sync
      if (w.status.behind > 0) {
        suggestedActions.push({
          type: 'sync',
          worktreeId: w.id,
          branch: w.branch,
          priority: w.status.behind > 10 ? 'high' : 'medium',
          description: `Branch is ${w.status.behind} commits behind remote`,
        });
      }

      // Has uncommitted changes
      if (w.status.modified > 0 || w.status.staged > 0) {
        suggestedActions.push({
          type: 'commit',
          worktreeId: w.id,
          branch: w.branch,
          priority: w.status.staged > 0 ? 'high' : 'medium',
          description: `Has ${w.status.modified} modified and ${w.status.staged} staged files`,
        });
      }

      // Merged and ready to archive
      if (w.merged && !w.archived && !hasSession) {
        suggestedActions.push({
          type: 'archive',
          worktreeId: w.id,
          branch: w.branch,
          priority: 'low',
          description: 'Branch merged, ready for cleanup',
        });
      }

      // Has unpushed commits
      if (w.status.ahead > 0) {
        suggestedActions.push({
          type: 'review',
          worktreeId: w.id,
          branch: w.branch,
          priority: w.status.ahead > 5 ? 'high' : 'medium',
          description: `Has ${w.status.ahead} unpushed commits ready for review`,
        });
      }
    }

    // Sort actions by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestedActions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // Build summary
    const summary = {
      totalWorktrees: worktrees.length,
      activeWorktrees: activeSessions.length,
      mergedWorktrees: worktrees.filter(w => w.merged).length,
      archivedWorktrees: worktrees.filter(w => w.archived).length,
      worktreesWithChanges: worktrees.filter(w =>
        w.status.modified > 0 || w.status.staged > 0 || w.status.untracked > 0
      ).length,
    };

    const response: HealthCheckResponse = {
      projectId,
      timestamp: new Date().toISOString(),
      worktrees: worktreeHealth,
      activeSessions,
      archiveCandidates,
      suggestedActions,
      summary,
    };

    return response;
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

  // Orchestrator loop control endpoints
  const { orchestratorLoopService } = await import('../services/orchestrator-loop.service.js');

  fastify.get('/orchestrator/loop/status', async () => {
    return orchestratorLoopService.getStatus();
  });

  fastify.post<{
    Querystring: { projectId?: string };
  }>('/orchestrator/loop/start', async (request, reply) => {
    const { projectId } = request.query;
    try {
      await orchestratorLoopService.start(projectId);
      return orchestratorLoopService.getStatus();
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  fastify.post('/orchestrator/loop/stop', async () => {
    await orchestratorLoopService.stop();
    return orchestratorLoopService.getStatus();
  });

  fastify.post('/orchestrator/loop/pause', async () => {
    orchestratorLoopService.pause();
    return orchestratorLoopService.getStatus();
  });

  fastify.post('/orchestrator/loop/resume', async () => {
    orchestratorLoopService.resume();
    return orchestratorLoopService.getStatus();
  });

  fastify.post('/orchestrator/loop/tick', async (_request, reply) => {
    try {
      const context = await orchestratorLoopService.manualTick();
      return { status: orchestratorLoopService.getStatus(), context };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Update loop configuration (e.g., model selection)
  fastify.post<{
    Body: { model?: string; tickIntervalMs?: number; enabled?: boolean };
  }>('/orchestrator/loop/config', async (request) => {
    const { model, tickIntervalMs, enabled } = request.body;

    const updates: Record<string, any> = {};
    if (model !== undefined) updates.model = model;
    if (tickIntervalMs !== undefined) updates.tickIntervalMs = tickIntervalMs;
    if (enabled !== undefined) updates.enabled = enabled;

    if (Object.keys(updates).length > 0) {
      orchestratorLoopService.updateConfig(updates);
    }

    return orchestratorLoopService.getStatus();
  });

  // Get available Ollama models
  fastify.get('/orchestrator/loop/models', async (_request, reply) => {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (!response.ok) {
        return reply.status(502).send({ error: 'Failed to fetch Ollama models' });
      }
      const data = await response.json() as { models: Array<{ name: string; size: number; modified_at: string }> };
      return {
        models: data.models?.map(m => ({
          name: m.name,
          size: m.size,
          modified: m.modified_at,
        })) || [],
      };
    } catch (err: any) {
      return reply.status(502).send({ error: `Ollama not available: ${err.message}` });
    }
  });
}
