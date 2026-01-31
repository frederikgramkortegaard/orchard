import type { FastifyInstance } from 'fastify';
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  isGitRepo?: boolean;
}

export async function filesRoutes(fastify: FastifyInstance) {
  // Browse directories for folder picker
  fastify.get<{
    Querystring: { path?: string };
  }>('/files/browse', async (request, reply) => {
    const requestedPath = request.query.path || homedir();

    // Expand ~ to home directory
    const targetPath = requestedPath.startsWith('~')
      ? requestedPath.replace('~', homedir())
      : requestedPath;

    if (!existsSync(targetPath)) {
      return reply.status(404).send({ error: 'Path not found' });
    }

    try {
      const stats = await stat(targetPath);
      if (!stats.isDirectory()) {
        return reply.status(400).send({ error: 'Path is not a directory' });
      }

      const entries = await readdir(targetPath, { withFileTypes: true });
      const result: DirectoryEntry[] = [];

      // Add parent directory entry if not at root
      if (targetPath !== '/') {
        result.push({
          name: '..',
          path: join(targetPath, '..'),
          type: 'directory',
        });
      }

      for (const entry of entries) {
        // Skip hidden files except .git check
        if (entry.name.startsWith('.') && entry.name !== '.git') continue;

        if (entry.isDirectory()) {
          const fullPath = join(targetPath, entry.name);
          const isGitRepo = existsSync(join(fullPath, '.git'));

          result.push({
            name: entry.name,
            path: fullPath,
            type: 'directory',
            isGitRepo,
          });
        }
      }

      // Sort directories: parent first, then alphabetically, git repos highlighted
      result.sort((a, b) => {
        if (a.name === '..') return -1;
        if (b.name === '..') return 1;
        // Git repos first
        if (a.isGitRepo && !b.isGitRepo) return -1;
        if (!a.isGitRepo && b.isGitRepo) return 1;
        return a.name.localeCompare(b.name);
      });

      return {
        currentPath: targetPath,
        entries: result,
      };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Get common paths for quick access
  fastify.get('/files/quick-paths', async () => {
    const home = homedir();
    const paths = [
      { name: 'Home', path: home },
      { name: 'Desktop', path: join(home, 'Desktop') },
      { name: 'Documents', path: join(home, 'Documents') },
      { name: 'Developer', path: join(home, 'Developer') },
      { name: 'Projects', path: join(home, 'Projects') },
      { name: 'Code', path: join(home, 'Code') },
    ];

    // Only return paths that exist
    return paths.filter(p => existsSync(p.path));
  });
}
