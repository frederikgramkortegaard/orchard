import type { FastifyInstance } from 'fastify';
import { simpleGit } from 'simple-git';
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
  worktreeId: string;
  currentBranch: string;
  commits: GitGraphNode[];
  branches: { name: string; head: string; isCurrent: boolean }[];
}

export interface CommitFilesResult {
  worktreeId: string;
  commitHash: string;
  files: {
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
  }[];
}

export interface CommitDetailResult {
  worktreeId: string;
  commit: GitCommitInfo;
  files: {
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
  }[];
  diff: string;
}

// Parse git log with graph format to extract branch topology
function parseGitGraph(logOutput: string, currentBranch: string): GitGraphNode[] {
  const lines = logOutput.trim().split('\n').filter(line => line.length > 0);
  const nodes: GitGraphNode[] = [];
  const branchHeads = new Map<string, number>(); // branch name -> column
  let nextColumn = 0;

  for (const line of lines) {
    // Format: hash|short|author|email|date|parents|refs|message
    const parts = line.split('|');
    if (parts.length < 8) continue;

    const [hash, hashShort, author, authorEmail, date, parentsStr, refsStr, ...messageParts] = parts;
    const message = messageParts.join('|'); // In case message contains |
    const parents = parentsStr ? parentsStr.split(' ').filter(p => p) : [];
    const refs = refsStr
      ? refsStr
          .replace(/[()]/g, '')
          .split(', ')
          .filter(r => r && !r.includes('->'))
          .map(r => r.replace('HEAD -> ', '').replace('origin/', ''))
      : [];

    const isMerge = parents.length > 1;

    // Assign column based on branch refs or parent tracking
    let column = 0;
    for (const ref of refs) {
      if (branchHeads.has(ref)) {
        column = branchHeads.get(ref)!;
        break;
      }
    }
    if (refs.length > 0 && !branchHeads.has(refs[0])) {
      branchHeads.set(refs[0], nextColumn);
      column = nextColumn;
      nextColumn++;
    }

    // Color based on column for visual distinction
    const branchColor = column % 6;

    nodes.push({
      commit: {
        hash,
        hashShort,
        message,
        author,
        authorEmail,
        date,
        parents,
        refs,
      },
      column,
      isMerge,
      branchColor,
    });
  }

  return nodes;
}

export async function gitHistoryRoutes(fastify: FastifyInstance) {
  // Get git commit history with graph information
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string; skip?: string; branch?: string };
  }>('/worktrees/:id/history', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const limit = parseInt(request.query.limit || '100', 10);
    const skip = parseInt(request.query.skip || '0', 10);
    const git = simpleGit(worktree.path);

    try {
      // Get current branch
      const branchSummary = await git.branch();
      const currentBranch = branchSummary.current;

      // Get commit log with custom format for graph parsing
      // Format: hash|short|author|email|date|parents|refs|message
      // Show only the current branch's history (not --all)
      const logResult = await git.raw([
        'log',
        currentBranch,
        `--max-count=${limit}`,
        `--skip=${skip}`,
        '--format=%H|%h|%an|%ae|%aI|%P|%D|%s',
      ]);

      const commits = parseGitGraph(logResult, currentBranch);

      // Get all branches with their heads
      const branches = branchSummary.all.map(name => ({
        name,
        head: branchSummary.branches[name]?.commit || '',
        isCurrent: name === currentBranch,
      }));

      return {
        worktreeId: worktree.id,
        currentBranch,
        commits,
        branches,
      } as GitHistoryResult;
    } catch (err: any) {
      console.error('Error getting git history:', err);
      return reply.status(500).send({ error: err.message || 'Failed to get git history' });
    }
  });

  // Get files changed in a specific commit
  fastify.get<{
    Params: { id: string; hash: string };
  }>('/worktrees/:id/commits/:hash/files', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const { hash } = request.params;
    const git = simpleGit(worktree.path);

    try {
      // Get files changed in this commit
      const diffResult = await git.raw([
        'diff-tree',
        '--no-commit-id',
        '--name-status',
        '-r',
        hash,
      ]);

      const files = diffResult
        .trim()
        .split('\n')
        .filter(line => line)
        .map(line => {
          const [statusCode, ...pathParts] = line.split('\t');
          const path = pathParts.join('\t'); // Handle paths with tabs
          let status: 'added' | 'modified' | 'deleted' | 'renamed' = 'modified';
          if (statusCode.startsWith('A')) status = 'added';
          else if (statusCode.startsWith('D')) status = 'deleted';
          else if (statusCode.startsWith('R')) status = 'renamed';
          return { path, status };
        });

      return {
        worktreeId: worktree.id,
        commitHash: hash,
        files,
      } as CommitFilesResult;
    } catch (err: any) {
      console.error('Error getting commit files:', err);
      return reply.status(500).send({ error: err.message || 'Failed to get commit files' });
    }
  });

  // Get detailed commit information including diff
  fastify.get<{
    Params: { id: string; hash: string };
  }>('/worktrees/:id/commits/:hash', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const { hash } = request.params;
    const git = simpleGit(worktree.path);

    try {
      // Get commit info
      const logResult = await git.raw([
        'log',
        '-1',
        '--format=%H|%h|%an|%ae|%aI|%P|%D|%s',
        hash,
      ]);

      const parts = logResult.trim().split('|');
      if (parts.length < 8) {
        return reply.status(404).send({ error: 'Commit not found' });
      }

      const [hashFull, hashShort, author, authorEmail, date, parentsStr, refsStr, ...messageParts] = parts;
      const message = messageParts.join('|');
      const parents = parentsStr ? parentsStr.split(' ').filter(p => p) : [];
      const refs = refsStr
        ? refsStr
            .replace(/[()]/g, '')
            .split(', ')
            .filter(r => r && !r.includes('->'))
        : [];

      // Get diff with stat
      const diffWithStat = await git.raw(['show', '--stat', '--format=', hash]);
      const diff = await git.raw(['show', '--format=', hash]);

      // Parse stat to get file changes
      const statLines = diffWithStat.trim().split('\n');
      const files = statLines
        .filter(line => line.includes('|'))
        .map(line => {
          const match = line.match(/^\s*(.+?)\s+\|\s+(\d+)\s*([+-]*)/);
          if (!match) return null;
          const [, path, changes, delta] = match;
          const additions = (delta.match(/\+/g) || []).length;
          const deletions = (delta.match(/-/g) || []).length;
          // Determine status from context
          let status: 'added' | 'modified' | 'deleted' | 'renamed' = 'modified';
          return { path: path.trim(), status, additions, deletions };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null);

      return {
        worktreeId: worktree.id,
        commit: {
          hash: hashFull,
          hashShort,
          message,
          author,
          authorEmail,
          date,
          parents,
          refs,
        },
        files,
        diff,
      } as CommitDetailResult;
    } catch (err: any) {
      console.error('Error getting commit details:', err);
      return reply.status(500).send({ error: err.message || 'Failed to get commit details' });
    }
  });

  // Get diff between two commits
  fastify.get<{
    Params: { id: string };
    Querystring: { base: string; target: string };
  }>('/worktrees/:id/compare', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const { base, target } = request.query;
    if (!base || !target) {
      return reply.status(400).send({ error: 'Both base and target commits are required' });
    }

    const git = simpleGit(worktree.path);

    try {
      const diff = await git.diff([base, target]);
      return {
        worktreeId: worktree.id,
        base,
        target,
        diff,
      };
    } catch (err: any) {
      console.error('Error comparing commits:', err);
      return reply.status(500).send({ error: err.message || 'Failed to compare commits' });
    }
  });

  // Get file tree at a specific commit
  fastify.get<{
    Params: { id: string; hash: string };
    Querystring: { path?: string };
  }>('/worktrees/:id/commits/:hash/tree', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const { hash } = request.params;
    const treePath = request.query.path || '';
    const git = simpleGit(worktree.path);

    try {
      const treeResult = await git.raw([
        'ls-tree',
        '-l',
        hash,
        treePath ? `${treePath}/` : '',
      ]);

      const entries = treeResult
        .trim()
        .split('\n')
        .filter(line => line)
        .map(line => {
          // Format: mode type hash size\tpath
          const match = line.match(/^(\d+)\s+(\w+)\s+([a-f0-9]+)\s+(-|\d+)\t(.+)$/);
          if (!match) return null;
          const [, mode, type, objectHash, size, path] = match;
          return {
            mode,
            type: type as 'blob' | 'tree',
            hash: objectHash,
            size: size === '-' ? null : parseInt(size, 10),
            name: path.split('/').pop() || path,
            path,
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);

      return {
        worktreeId: worktree.id,
        commitHash: hash,
        path: treePath,
        entries,
      };
    } catch (err: any) {
      console.error('Error getting file tree:', err);
      return reply.status(500).send({ error: err.message || 'Failed to get file tree' });
    }
  });

  // Get file content at a specific commit
  fastify.get<{
    Params: { id: string; hash: string };
    Querystring: { path: string };
  }>('/worktrees/:id/commits/:hash/file', async (request, reply) => {
    const worktree = worktreeService.getWorktree(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const { hash } = request.params;
    const { path } = request.query;
    if (!path) {
      return reply.status(400).send({ error: 'File path is required' });
    }

    const git = simpleGit(worktree.path);

    try {
      const content = await git.raw(['show', `${hash}:${path}`]);
      return {
        worktreeId: worktree.id,
        commitHash: hash,
        path,
        content,
      };
    } catch (err: any) {
      console.error('Error getting file content:', err);
      return reply.status(500).send({ error: err.message || 'Failed to get file content' });
    }
  });
}
