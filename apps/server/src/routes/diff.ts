import type { FastifyInstance } from 'fastify';
import { simpleGit } from 'simple-git';
import { worktreeService } from '../services/worktree.service.js';
import { projectService } from '../services/project.service.js';

export interface DiffOptions {
  type: 'working' | 'staged' | 'branch' | 'commit';
  base?: string;  // Base commit/branch for comparison
  target?: string; // Target commit/branch (defaults to HEAD for some types)
}

export async function diffRoutes(fastify: FastifyInstance) {
  // Get diff for a worktree
  fastify.get<{
    Params: { id: string };
    Querystring: { type?: string; base?: string; target?: string };
  }>('/worktrees/:id/diff', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const { type = 'working', base, target } = request.query;
    const git = simpleGit(worktree.path);

    try {
      let diff: string;

      switch (type) {
        case 'staged':
          // Show staged changes (git diff --cached)
          diff = await git.diff(['--cached']);
          break;

        case 'working':
          // Show unstaged changes (git diff)
          diff = await git.diff();
          break;

        case 'branch': {
          // Show diff between current branch and another branch
          const targetBranch = base || 'main';
          diff = await git.diff([`${targetBranch}...HEAD`]);
          break;
        }

        case 'commit': {
          // Show diff between two commits
          if (!base) {
            // Default to showing the last commit's changes
            diff = await git.diff(['HEAD~1', 'HEAD']);
          } else if (target) {
            diff = await git.diff([base, target]);
          } else {
            diff = await git.diff([base, 'HEAD']);
          }
          break;
        }

        default:
          return reply.status(400).send({ error: 'Invalid diff type' });
      }

      return {
        worktreeId: worktree.id,
        branch: worktree.branch,
        type,
        base: base || null,
        target: target || null,
        diff,
      };
    } catch (err: any) {
      console.error('Error getting diff:', err);
      return reply.status(500).send({ error: err.message || 'Failed to get diff' });
    }
  });

  // Get list of commits for a worktree (for commit selection)
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>('/worktrees/:id/commits', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const limit = parseInt(request.query.limit || '50', 10);
    const git = simpleGit(worktree.path);

    try {
      const log = await git.log({ maxCount: limit });
      return {
        worktreeId: worktree.id,
        commits: log.all.map((commit) => ({
          hash: commit.hash,
          hashShort: commit.hash.slice(0, 7),
          message: commit.message,
          author: commit.author_name,
          date: commit.date,
        })),
      };
    } catch (err: any) {
      console.error('Error getting commits:', err);
      return reply.status(500).send({ error: err.message || 'Failed to get commits' });
    }
  });

  // Get list of branches for diff comparison
  fastify.get<{
    Params: { id: string };
  }>('/worktrees/:id/branches', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const git = simpleGit(worktree.path);

    try {
      const branches = await git.branchLocal();
      return {
        worktreeId: worktree.id,
        currentBranch: worktree.branch,
        branches: branches.all,
      };
    } catch (err: any) {
      console.error('Error getting branches:', err);
      return reply.status(500).send({ error: err.message || 'Failed to get branches' });
    }
  });
}
