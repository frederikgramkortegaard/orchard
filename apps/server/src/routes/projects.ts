import type { FastifyInstance } from 'fastify';
import { projectService } from '../services/project.service.js';

// Track which projects are currently "open" in the session
const openProjectIds = new Set<string>();

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
}
