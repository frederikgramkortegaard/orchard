import type { FastifyInstance } from 'fastify';
import { databaseService } from '../services/database.service.js';
import { projectService } from '../services/project.service.js';
import { worktreeService } from '../services/worktree.service.js';

export async function mergeQueueRoutes(fastify: FastifyInstance) {
  // Get the merge queue for a project
  fastify.get<{
    Params: { projectId: string };
  }>('/merge-queue/:projectId', async (request, reply) => {
    const { projectId } = request.params;

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const queue = databaseService.getMergeQueue(project.path);
    return { queue };
  });

  // Get a specific merge queue entry
  fastify.get<{
    Params: { projectId: string; worktreeId: string };
  }>('/merge-queue/:projectId/:worktreeId', async (request, reply) => {
    const { projectId, worktreeId } = request.params;

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const entry = databaseService.getMergeQueueEntry(project.path, worktreeId);
    if (!entry) {
      return reply.status(404).send({ error: 'Merge queue entry not found' });
    }

    return entry;
  });

  // Add an entry to the merge queue (typically called internally on completion)
  fastify.post<{
    Body: {
      worktreeId: string;
      summary: string;
    };
  }>('/merge-queue', async (request, reply) => {
    const { worktreeId, summary } = request.body;

    if (!worktreeId) {
      return reply.status(400).send({ error: 'worktreeId is required' });
    }

    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const project = projectService.getProject(worktree.projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Check if worktree has commits ahead of main
    const hasCommits = worktree.status?.ahead > 0;

    databaseService.addToMergeQueue(project.path, {
      worktreeId,
      branch: worktree.branch,
      summary: summary || '',
      hasCommits,
    });

    return {
      success: true,
      message: `Added ${worktree.branch} to merge queue`,
      hasCommits,
    };
  });

  // Mark a merge queue entry as merged
  fastify.post<{
    Params: { projectId: string; worktreeId: string };
  }>('/merge-queue/:projectId/:worktreeId/merge', async (request, reply) => {
    const { projectId, worktreeId } = request.params;

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const success = databaseService.markMergeQueueEntryMerged(project.path, worktreeId);
    if (!success) {
      return reply.status(404).send({ error: 'Merge queue entry not found' });
    }

    return { success: true, message: 'Marked as merged' };
  });

  // Remove an entry from the merge queue
  fastify.delete<{
    Params: { projectId: string; worktreeId: string };
  }>('/merge-queue/:projectId/:worktreeId', async (request, reply) => {
    const { projectId, worktreeId } = request.params;

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const success = databaseService.removeFromMergeQueue(project.path, worktreeId);
    if (!success) {
      return reply.status(404).send({ error: 'Merge queue entry not found' });
    }

    return { success: true, message: 'Removed from merge queue' };
  });
}
