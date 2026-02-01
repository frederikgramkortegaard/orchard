import type { FastifyInstance } from 'fastify';
import { simpleGit } from 'simple-git';
import { existsSync } from 'fs';
import { projectService } from '../services/project.service.js';
import { worktreeService } from '../services/worktree.service.js';

export interface GitCommitInfo {
  hash: string;
  hashShort: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  parents: string[];
  refs: string[];
}

export interface GitGraphNode {
  commit: GitCommitInfo;
  column: number;
  isMerge: boolean;
  branchColor: number;
}

export interface GitHistoryResult {
  worktreeId?: string;
  currentBranch: string;
  commits: GitGraphNode[];
  branches: { name: string; head: string; isCurrent: boolean }[];
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
      // Get current branch
      const branchSummary = await git.branch();
      const currentBranch = branchSummary.current;

      // Get all branches for reference
      const branches = branchSummary.all.map(name => ({
        name,
        head: branchSummary.branches[name]?.commit || '',
        isCurrent: name === currentBranch,
      }));

      // Get git log with --all flag to show all branches
      const log = await git.log({
        maxCount: limit,
        '--all': null,
      });

      const commits: GitGraphNode[] = log.all.map((commit, index) => ({
        commit: {
          hash: commit.hash,
          hashShort: commit.hash.slice(0, 7),
          message: commit.message,
          author: commit.author_name,
          authorEmail: commit.author_email,
          date: commit.date,
          parents: commit.refs ? commit.refs.split(',').map(r => r.trim()) : [],
          refs: commit.refs ? commit.refs.split(',').map(r => r.trim()).filter(r => r) : [],
        },
        column: 0,
        isMerge: false,
        branchColor: index % 6,
      }));

      return {
        currentBranch,
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
      // Get current branch
      const branchSummary = await git.branch();
      const currentBranch = branchSummary.current;

      // Get branches
      const branches = branchSummary.all.map(name => ({
        name,
        head: branchSummary.branches[name]?.commit || '',
        isCurrent: name === currentBranch,
      }));

      // Get git log for current branch only (not --all)
      const log = await git.log({ maxCount: limit });

      const commits: GitGraphNode[] = log.all.map((commit, index) => ({
        commit: {
          hash: commit.hash,
          hashShort: commit.hash.slice(0, 7),
          message: commit.message,
          author: commit.author_name,
          authorEmail: commit.author_email,
          date: commit.date,
          parents: commit.refs ? commit.refs.split(',').map(r => r.trim()) : [],
          refs: commit.refs ? commit.refs.split(',').map(r => r.trim()).filter(r => r) : [],
        },
        column: 0,
        isMerge: false,
        branchColor: index % 6,
      }));

      return {
        worktreeId: worktree.id,
        currentBranch,
        commits,
        branches,
      } as GitHistoryResult;
    } catch (err: any) {
      console.error('Error getting worktree history:', err);
      return reply.status(500).send({ error: err.message || 'Failed to get history' });
    }
  });
}
