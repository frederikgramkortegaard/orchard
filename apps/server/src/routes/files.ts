import type { FastifyInstance } from 'fastify';
import { readdir, stat, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, extname } from 'path';
import { homedir } from 'os';
import { fileTrackingService } from '../services/file-tracking.service.js';

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  isGitRepo?: boolean;
}

export interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
}

// Skip these directories when building tree
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  '.cache', 'coverage', '.turbo', '.vscode', '.idea',
  '__pycache__', '.pytest_cache', 'venv', '.venv'
]);

// Binary file extensions to skip
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.wav', '.avi', '.mkv', '.mov',
  '.lock'
]);

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

  // Get file tree for a directory
  fastify.get<{
    Querystring: { path: string };
  }>('/files/tree', async (request, reply) => {
    const { path: dirPath } = request.query;

    if (!dirPath || !existsSync(dirPath)) {
      return reply.status(404).send({ error: 'Path not found' });
    }

    async function buildTree(currentPath: string): Promise<FileTreeEntry[]> {

      try {
        const entries = await readdir(currentPath, { withFileTypes: true });
        const result: FileTreeEntry[] = [];

        // Sort: directories first, then files, alphabetically
        const sorted = entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (const entry of sorted) {
          // Skip hidden files and ignored directories
          if (entry.name.startsWith('.')) continue;
          if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;

          const fullPath = join(currentPath, entry.name);

          if (entry.isDirectory()) {
            const children = await buildTree(fullPath);
            result.push({
              name: entry.name,
              path: fullPath,
              type: 'directory',
              children,
            });
          } else {
            // Skip binary files in the tree listing
            const ext = extname(entry.name).toLowerCase();
            if (BINARY_EXTENSIONS.has(ext)) continue;

            result.push({
              name: entry.name,
              path: fullPath,
              type: 'file',
            });
          }
        }

        return result;
      } catch (err) {
        return [];
      }
    }

    const tree = await buildTree(dirPath);
    return { root: dirPath, entries: tree };
  });

  // Read file content
  fastify.get<{
    Querystring: { path: string };
  }>('/files/content', async (request, reply) => {
    const { path: filePath } = request.query;

    if (!filePath || !existsSync(filePath)) {
      return reply.status(404).send({ error: 'File not found' });
    }

    try {
      const stats = await stat(filePath);

      if (stats.isDirectory()) {
        return reply.status(400).send({ error: 'Path is a directory' });
      }

      // Limit file size (5MB max)
      if (stats.size > 5 * 1024 * 1024) {
        return reply.status(400).send({ error: 'File too large (max 5MB)' });
      }

      const ext = extname(filePath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        return reply.status(400).send({ error: 'Binary files cannot be displayed' });
      }

      const content = await readFile(filePath, 'utf-8');
      return { path: filePath, content };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Save file content
  fastify.post<{
    Body: { path: string; content: string };
  }>('/files/save', async (request, reply) => {
    const { path: filePath, content } = request.body;

    if (!filePath) {
      return reply.status(400).send({ error: 'File path is required' });
    }

    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: 'File not found' });
    }

    try {
      const stats = await stat(filePath);

      if (stats.isDirectory()) {
        return reply.status(400).send({ error: 'Path is a directory' });
      }

      const ext = extname(filePath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        return reply.status(400).send({ error: 'Binary files cannot be saved' });
      }

      await writeFile(filePath, content, 'utf-8');
      return { path: filePath, saved: true };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Get file locks per agent (which files are being modified by which worktree)
  fastify.get<{
    Querystring: { projectId: string };
  }>('/files/locks', async (request, reply) => {
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId query parameter required' });
    }

    try {
      const locks = await fileTrackingService.getFileLocksGroupedByWorktree(projectId);
      return { projectId, locks };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Detect potential merge conflicts between agents
  fastify.get<{
    Querystring: { projectId: string };
  }>('/files/conflicts', async (request, reply) => {
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId query parameter required' });
    }

    try {
      const conflicts = await fileTrackingService.detectConflicts(projectId);
      const worktreeConflicts = await fileTrackingService.getWorktreesWithConflicts(projectId);

      return {
        projectId,
        conflicts,
        worktreeConflicts: Object.fromEntries(worktreeConflicts),
        hasConflicts: conflicts.length > 0,
      };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
