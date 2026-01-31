import type { FastifyInstance } from 'fastify';
import { simpleGit } from 'simple-git';
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { projectService } from '../services/project.service.js';

// Track which projects are currently "open" in the session
const openProjectIds = new Set<string>();

interface CommitsByDay {
  date: string;
  count: number;
}

interface MessagesByDay {
  date: string;
  count: number;
}

export async function projectsRoutes(fastify: FastifyInstance) {
  // List available projects (all on disk)
  fastify.get('/projects/available', async () => {
    return projectService.getAllProjects();
  });

  // Open a project (add to open set)
  fastify.post<{ Params: { id: string } }>('/projects/:id/open', async (request, reply) => {
    const project = projectService.getProject(request.params.id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    openProjectIds.add(project.id);
    return project;
  });

  // Close a project (remove from open set)
  fastify.post<{ Params: { id: string } }>('/projects/:id/close', async (request, reply) => {
    openProjectIds.delete(request.params.id);
    return { success: true };
  });
  // Create project from git URL or local path
  fastify.post<{
    Body: { repoUrl?: string; localPath?: string; name?: string };
  }>('/projects', async (request, reply) => {
    const { repoUrl, localPath, name } = request.body;

    try {
      let project;
      if (repoUrl) {
        project = await projectService.createProject(repoUrl, name);
      } else if (localPath) {
        project = await projectService.createProjectFromLocal(localPath, name);
      } else {
        return reply.status(400).send({ error: 'repoUrl or localPath required' });
      }
      // Auto-open newly created projects
      openProjectIds.add(project.id);
      return project;
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // List open projects only
  fastify.get('/projects', async () => {
    const allProjects = projectService.getAllProjects();
    return allProjects.filter(p => openProjectIds.has(p.id));
  });

  // Get project by ID
  fastify.get<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const project = projectService.getProject(request.params.id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    return project;
  });

  // Delete project
  fastify.delete<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const success = await projectService.deleteProject(request.params.id);
    if (!success) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    return { success: true };
  });

  // Get commit stats for dashboard
  fastify.get<{
    Params: { id: string };
    Querystring: { days?: string };
  }>('/projects/:id/commits', async (request, reply) => {
    const { id } = request.params;
    const days = parseInt(request.query.days || '14', 10);

    const project = projectService.getProject(id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    try {
      // Find the git directory - for in-place projects it's the project path,
      // for cloned projects we need to find the main worktree
      const mainWorktreePath = projectService.getMainWorktreePath(id);
      if (!mainWorktreePath || !existsSync(mainWorktreePath)) {
        return { commitsByDay: [], totalCommits: 0 };
      }

      const git = simpleGit(mainWorktreePath);
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString().split('T')[0];

      const log = await git.log({
        '--since': sinceStr,
        '--all': null,
      });

      // Group commits by day
      const commitMap = new Map<string, number>();
      for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        commitMap.set(key, 0);
      }

      for (const commit of log.all) {
        const date = commit.date.split(' ')[0]; // Get just the date part
        if (commitMap.has(date)) {
          commitMap.set(date, (commitMap.get(date) || 0) + 1);
        }
      }

      const commitsByDay: CommitsByDay[] = Array.from(commitMap.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        commitsByDay,
        totalCommits: log.total,
      };
    } catch (err: any) {
      console.error('Error fetching commits:', err);
      return { commitsByDay: [], totalCommits: 0 };
    }
  });

  // Get message stats for dashboard
  fastify.get<{
    Params: { id: string };
    Querystring: { days?: string };
  }>('/projects/:id/messages', async (request, reply) => {
    const { id } = request.params;
    const days = parseInt(request.query.days || '14', 10);

    const project = projectService.getProject(id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    try {
      const queuePath = join(project.path, '.orchard', 'message-queue.json');

      // Initialize the map with zeros for all days
      const messageMap = new Map<string, number>();
      for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        messageMap.set(key, 0);
      }

      let totalMessages = 0;

      if (existsSync(queuePath)) {
        const data = await readFile(queuePath, 'utf-8');
        const messages = JSON.parse(data);

        const since = new Date();
        since.setDate(since.getDate() - days);

        for (const msg of messages) {
          const msgDate = new Date(msg.timestamp);
          if (msgDate >= since) {
            const dateKey = msgDate.toISOString().split('T')[0];
            if (messageMap.has(dateKey)) {
              messageMap.set(dateKey, (messageMap.get(dateKey) || 0) + 1);
            }
            totalMessages++;
          }
        }
      }

      // Also count chat messages
      const chatPath = join(project.path, '.orchard', 'chat.json');
      if (existsSync(chatPath)) {
        const data = await readFile(chatPath, 'utf-8');
        const chatMessages = JSON.parse(data);

        const since = new Date();
        since.setDate(since.getDate() - days);

        for (const msg of chatMessages) {
          const msgDate = new Date(msg.timestamp);
          if (msgDate >= since) {
            const dateKey = msgDate.toISOString().split('T')[0];
            if (messageMap.has(dateKey)) {
              messageMap.set(dateKey, (messageMap.get(dateKey) || 0) + 1);
            }
            totalMessages++;
          }
        }
      }

      const messagesByDay: MessagesByDay[] = Array.from(messageMap.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        messagesByDay,
        totalMessages,
      };
    } catch (err: any) {
      console.error('Error fetching messages:', err);
      return { messagesByDay: [], totalMessages: 0 };
    }
  });
}
