import type { FastifyInstance } from 'fastify';
import { simpleGit } from 'simple-git';
import { existsSync } from 'fs';
import { projectService } from '../services/project.service.js';
import { worktreeService } from '../services/worktree.service.js';

export interface GitHistoryCommit {
  hash: string;
  hashShort: string;
  message: string;
  author: string;
  date: string;
  branch?: string;
}

export interface GitHistoryResult {
  commits: GitHistoryCommit[];
  branches?: string[];
}

export async function gitHistoryRoutes(fastify: FastifyInstance) {
  // Get project-wide git history (all branches)
  fastify.get<{
    Params: { projectId: string };
    Querystring: { limit?: string };
  }>('/projects/:projectId/history', async (request, reply) => {
    const { projectId } = request.params;
    const limit = parseInt(request.query.limit || '100', 10);

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const mainWorktreePath = projectService.getMainWorktreePath(projectId);
    if (!mainWorktreePath || !existsSync(mainWorktreePath)) {
      return reply.status(404).send({ error: 'Project path not found' });
    }

    const git = simpleGit(mainWorktreePath);

    try {
      // Get all branches for reference
      const branchResult = await git.branch(['-a']);
      const branches = branchResult.all;

      // Get git log with --all flag to show all branches
      const log = await git.log({
        maxCount: limit,
        '--all': null,
      });

      const commits: GitHistoryCommit[] = log.all.map((commit) => ({
        hash: commit.hash,
        hashShort: commit.hash.slice(0, 7),
        message: commit.message,
        author: commit.author_name,
        date: commit.date,
      }));

      return {
        commits,
        branches,
      } as GitHistoryResult;
    } catch (err: any) {
      console.error('Error getting project history:', err);
      return reply.status(500).send({ error: err.message || 'Failed to get history' });
    }
  });

  // Get git history for a specific worktree
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>('/worktrees/:id/history', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const limit = parseInt(request.query.limit || '100', 10);
    const git = simpleGit(worktree.path);

    try {
      const log = await git.log({ maxCount: limit });

      const commits: GitHistoryCommit[] = log.all.map((commit) => ({
        hash: commit.hash,
        hashShort: commit.hash.slice(0, 7),
        message: commit.message,
        author: commit.author_name,
        date: commit.date,
      }));

      return {
        commits,
      } as GitHistoryResult;
    } catch (err: any) {
      console.error('Error getting worktree history:', err);
      return reply.status(500).send({ error: err.message || 'Failed to get history' });
    }
  });
}
