import type { FastifyInstance } from 'fastify';
import { databaseService } from '../services/database.service.js';
import { projectService } from '../services/project.service.js';
import { worktreeService } from '../services/worktree.service.js';
import { simpleGit } from 'simple-git';

export async function mergeQueueRoutes(fastify: FastifyInstance) {
  // GET /merge-queue?projectId=X - list pending merges
  fastify.get<{
    Querystring: { projectId: string };
  }>('/merge-queue', async (request, reply) => {
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId query param required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const queue = databaseService.getMergeQueue(project.path);
    return queue;
  });

  // POST /merge-queue/:worktreeId/merge - perform the merge
  fastify.post<{
    Params: { worktreeId: string };
    Querystring: { projectId: string };
  }>('/merge-queue/:worktreeId/merge', async (request, reply) => {
    const { worktreeId } = request.params;
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId query param required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Get the merge queue entry
    const entry = databaseService.getMergeQueueEntry(project.path, worktreeId);
    if (!entry) {
      return reply.status(404).send({ error: 'Merge queue entry not found' });
    }

    if (entry.merged) {
      return reply.status(400).send({ error: 'Already merged' });
    }

    // Get the worktree info
    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    // Get the main worktree path for the merge
    const mainPath = projectService.getMainWorktreePath(projectId);
    if (!mainPath) {
      return reply.status(500).send({ error: 'Could not find main worktree' });
    }

    try {
      const git = simpleGit(mainPath);
      const defaultBranch = await worktreeService.getDefaultBranch(projectId);

      // Checkout the default branch
      await git.checkout(defaultBranch);

      // Merge the feature branch
      await git.merge([entry.branch, '--no-ff', '-m', `Merge branch '${entry.branch}'`]);

      // Mark as merged in the queue
      databaseService.markMergeQueueEntryMerged(project.path, worktreeId);

      console.log(`[MergeQueue] Successfully merged ${entry.branch} into ${defaultBranch}`);

      return {
        success: true,
        message: `Merged ${entry.branch} into ${defaultBranch}`,
        branch: entry.branch,
      };
    } catch (err: any) {
      console.error(`[MergeQueue] Merge failed for ${entry.branch}:`, err);

      // Check if it's a merge conflict
      if (err.message?.includes('CONFLICT') || err.message?.includes('Automatic merge failed')) {
        return reply.status(409).send({
          error: 'Merge conflict',
          message: err.message,
          branch: entry.branch,
        });
      }

      return reply.status(500).send({
        error: 'Merge failed',
        message: err.message || String(err),
      });
    }
  });

  // DELETE /merge-queue/:worktreeId - remove from queue
  fastify.delete<{
    Params: { worktreeId: string };
    Querystring: { projectId: string };
  }>('/merge-queue/:worktreeId', async (request, reply) => {
    const { worktreeId } = request.params;
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId query param required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const removed = databaseService.removeFromMergeQueue(project.path, worktreeId);
    if (!removed) {
      return reply.status(404).send({ error: 'Merge queue entry not found' });
    }

    return { success: true, message: 'Removed from merge queue' };
  });

  // POST /merge-queue - manually add to merge queue (for report_completion integration)
  fastify.post<{
    Body: {
      worktreeId: string;
      summary?: string;
    };
    Querystring: { projectId: string };
  }>('/merge-queue', async (request, reply) => {
    const { worktreeId, summary } = request.body;
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId query param required' });
    }

    if (!worktreeId) {
      return reply.status(400).send({ error: 'worktreeId required in body' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    // Check if the worktree has any commits
    const defaultBranch = await worktreeService.getDefaultBranch(projectId);
    let hasCommits = false;
    try {
      const git = simpleGit(worktree.path);
      const log = await git.log([`${defaultBranch}..HEAD`, '--oneline']);
      hasCommits = log.total > 0;
    } catch {
      // If the command fails, assume no commits
    }

    databaseService.addToMergeQueue(project.path, {
      worktreeId,
      branch: worktree.branch,
      summary: summary || '',
      hasCommits,
    });

    return {
      success: true,
      message: 'Added to merge queue',
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

  // Pop the first entry from the merge queue (get and remove atomically)
  fastify.post<{
    Params: { projectId: string };
  }>('/merge-queue/:projectId/pop', async (request, reply) => {
    const { projectId } = request.params;

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const entry = databaseService.popFromMergeQueue(project.path);
    if (!entry) {
      return reply.status(404).send({ error: 'Merge queue is empty' });
    }

    return {
      success: true,
      entry,
    };
  });
}
