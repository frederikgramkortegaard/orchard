import type { FastifyInstance } from 'fastify';
import { worktreeService } from '../services/worktree.service.js';
import { projectService } from '../services/project.service.js';
import { fileTrackingService } from '../services/file-tracking.service.js';
import { databaseService } from '../services/database.service.js';

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
    Body: { projectId: string; branch: string; newBranch?: boolean; baseBranch?: string; mode?: 'normal' | 'plan' };
  }>('/worktrees', async (request, reply) => {
    const { projectId, branch, newBranch, baseBranch, mode } = request.body;

    if (!projectId || !branch) {
      return reply.status(400).send({ error: 'projectId and branch required' });
    }

    try {
      // Check for existing file conflicts before creating the worktree
      const existingConflicts = await fileTrackingService.detectConflicts(projectId);
      const project = projectService.getProject(projectId);

      // Log warning if there are already files being modified by multiple agents
      if (existingConflicts.length > 0 && project) {
        const conflictingFiles = existingConflicts.map(c => c.filePath);
        const conflictingBranches = new Set<string>();
        for (const conflict of existingConflicts) {
          for (const wt of conflict.worktrees) {
            conflictingBranches.add(wt.branch);
          }
        }

        databaseService.addActivityLog(project.path, projectId, {
          type: 'event',
          category: 'worktree',
          summary: `Creating agent ${branch} while ${conflictingFiles.length} file(s) have potential conflicts`,
          details: {
            warningType: 'pre_creation_conflict_check',
            newBranch: branch,
            existingConflicts: existingConflicts.length,
            conflictingBranches: Array.from(conflictingBranches),
            conflictingFiles,
          },
        });
      }

      const worktree = await worktreeService.createWorktree(projectId, branch, {
        newBranch,
        baseBranch,
        mode,
      });

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

  // Archive worktree - mark as archived
  fastify.post<{ Params: { id: string } }>('/worktrees/:id/archive', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    if (worktree.isMain) {
      return reply.status(400).send({ error: 'Cannot archive main worktree' });
    }

    // Mark worktree as archived (persists to disk)
    const archivedWorktree = await worktreeService.archiveWorktree(request.params.id);
    if (!archivedWorktree) {
      return reply.status(500).send({ error: 'Failed to archive worktree' });
    }

    return { success: true, worktree: archivedWorktree };
  });
}
