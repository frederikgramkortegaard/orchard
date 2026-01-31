import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { projectService } from '../services/project.service.js';
import { databaseService } from '../services/database.service.js';

export async function messagesRoutes(fastify: FastifyInstance) {
  // Get orchestrator activity log (from SQLite)
  fastify.get<{
    Querystring: { projectId: string; lines?: string; type?: string; category?: string };
  }>('/orchestrator/log', async (request, reply) => {
    const { projectId, lines = '50', type, category } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const limit = parseInt(lines, 10) || 50;
    const logs = databaseService.getActivityLogs(project.path, project.id, {
      limit,
      type: type as any,
      category: category as any,
    });

    // Format as lines for backward compatibility
    const formattedLines = logs.reverse().map(log => {
      const timestamp = log.timestamp;
      return `[${timestamp}] [${log.type}] [${log.category}] ${log.summary}`;
    });

    return {
      lines: formattedLines,
      total: logs.length,
      lastModified: new Date().toISOString(),
    };
  });

  // Get unified activity log with structured data (includes agent names)
  fastify.get<{
    Querystring: { projectId: string; limit?: string; category?: string };
  }>('/orchestrator/activity', async (request, reply) => {
    const { projectId, limit = '100', category } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const numLimit = parseInt(limit, 10) || 100;
    const logs = databaseService.getActivityLogs(project.path, project.id, {
      limit: numLimit,
      category: category as any,
    });

    // Parse details and extract agent info
    const activities = logs.reverse().map(log => {
      let details: Record<string, unknown> = {};
      try {
        details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
      } catch {
        // Keep empty details on parse error
      }

      // Extract agent/worktree name from details or summary
      let agentName: string | null = null;
      if (details.branch) {
        agentName = details.branch as string;
      } else if (details.worktreeId) {
        agentName = details.worktreeId as string;
      }

      // Determine activity type from log data
      let activityType: 'progress' | 'completion' | 'error' | 'question' | 'event' | 'system' = 'event';
      const summary = log.summary.toLowerCase();
      if (log.type === 'error' || summary.includes('error') || summary.includes('blocker')) {
        activityType = 'error';
      } else if (summary.includes('completed') || summary.includes('completion')) {
        activityType = 'completion';
      } else if (summary.includes('progress')) {
        activityType = 'progress';
      } else if (summary.includes('question')) {
        activityType = 'question';
      } else if (log.category === 'system' || log.category === 'orchestrator') {
        activityType = 'system';
      }

      return {
        id: log.id,
        timestamp: log.timestamp,
        type: log.type,
        category: log.category,
        activityType,
        summary: log.summary,
        agentName,
        details: {
          status: details.status,
          percentComplete: details.percentComplete,
          currentStep: details.currentStep,
          severity: details.severity,
          context: details.context,
          question: details.question,
          options: details.options,
          suggestedAction: details.suggestedAction,
        },
      };
    });

    return {
      activities,
      total: activities.length,
      lastModified: new Date().toISOString(),
    };
  });

  // Append to orchestrator log (to SQLite)
  fastify.post<{
    Body: { projectId: string; message: string; type?: string; category?: string };
  }>('/orchestrator/log', async (request, reply) => {
    const { projectId, message, type = 'event', category = 'system' } = request.body;

    if (!projectId || !message) {
      return reply.status(400).send({ error: 'projectId and message required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const id = databaseService.addActivityLog(project.path, project.id, {
      type: type as any,
      category: category as any,
      summary: message,
    });

    return { success: true, id, timestamp: new Date().toISOString() };
  });

  // Clear orchestrator log
  fastify.post<{
    Querystring: { projectId: string };
  }>('/orchestrator/log/clear', async (request, reply) => {
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Clear all activity logs for this project (or keep last 24 hours)
    const cleared = databaseService.clearOldActivityLogs(project.path, project.id, 0);
    return { success: true, cleared };
  });

  // Queue a message for the orchestrator (adds to chat as user message)
  fastify.post<{
    Body: { projectId: string; text?: string; content?: string };
  }>('/messages', async (request, reply) => {
    const { projectId, text, content } = request.body;
    const messageContent = content || text;

    if (!projectId || !messageContent) {
      return reply.status(400).send({ error: 'projectId and content (or text) required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const messageId = randomUUID();
    databaseService.addChatMessage(project.path, {
      id: messageId,
      projectId: project.id,
      from: 'user',
      text: messageContent,
    });

    return {
      success: true,
      message: {
        id: messageId,
        projectId: project.id,
        text: messageContent,
        content: messageContent,
        timestamp: new Date().toISOString(),
        from: 'user',
        processed: false,
        read: false,
      },
    };
  });

  // Get unread/unprocessed messages for a project
  fastify.get<{
    Querystring: { projectId: string; markProcessed?: string; markRead?: string };
  }>('/messages', async (request, reply) => {
    const { projectId, markProcessed, markRead } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const messages = databaseService.getChatMessages(project.path, project.id, {
      unprocessedOnly: true,
      from: 'user',
    });

    // Optionally mark as processed
    if ((markProcessed === 'true' || markRead === 'true') && messages.length > 0) {
      databaseService.markChatMessagesProcessed(
        project.path,
        projectId,
        messages.map(m => m.id)
      );
    }

    return messages.map(m => ({
      ...m,
      content: m.text,
      read: m.processed,
    }));
  });

  // Clear read/processed messages (no-op for SQLite, messages stay in DB)
  fastify.delete<{
    Querystring: { projectId: string };
  }>('/messages', async (request, reply) => {
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    // In SQLite we keep messages, just mark as processed
    return { success: true, cleared: 0 };
  });

  // Mark specific messages as read/processed
  fastify.post<{
    Body: { projectId: string; messageIds?: string[] };
  }>('/messages/read', async (request, reply) => {
    const { projectId, messageIds } = request.body;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const marked = databaseService.markChatMessagesProcessed(project.path, project.id, messageIds);
    return { success: true, marked };
  });

  // Get all messages (including processed)
  fastify.get<{
    Querystring: { projectId: string };
  }>('/messages/all', async (request, reply) => {
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const messages = databaseService.getChatMessages(project.path, project.id, { limit: 200 });
    return messages.map(m => ({
      ...m,
      content: m.text,
      read: m.processed,
    }));
  });

  // Get chat history (main chat endpoint)
  fastify.get<{
    Querystring: { projectId: string; limit?: string };
  }>('/chat', async (request, reply) => {
    const { projectId, limit = '50' } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const numLimit = parseInt(limit, 10) || 50;
    const messages = databaseService.getRecentChatMessages(project.path, project.id, numLimit);

    // Return in backward compatible format
    return messages.map(m => ({
      id: m.id,
      projectId: m.projectId,
      text: m.text,
      timestamp: m.timestamp,
      from: m.from,
      replyTo: m.replyTo,
    }));
  });

  // Send a chat message (from user or orchestrator)
  fastify.post<{
    Body: { projectId: string; text: string; from: 'user' | 'orchestrator'; replyTo?: string };
  }>('/chat', async (request, reply) => {
    const { projectId, text, from, replyTo } = request.body;

    if (!projectId || !text || !from) {
      return reply.status(400).send({ error: 'projectId, text, and from required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const messageId = randomUUID();
    databaseService.addChatMessage(project.path, {
      id: messageId,
      projectId: project.id,
      from,
      text,
      replyTo,
    });

    const message = {
      id: messageId,
      projectId: project.id,
      text,
      timestamp: new Date().toISOString(),
      from,
      replyTo,
    };

    return { success: true, message };
  });

  // Get unprocessed user message count
  fastify.get<{
    Querystring: { projectId: string };
  }>('/messages/unread-count', async (request, reply) => {
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const count = databaseService.getUnprocessedUserMessageCount(project.path, project.id);
    return { count };
  });

  // Migrate existing file-based data to SQLite
  fastify.post<{
    Body: { projectId: string };
  }>('/messages/migrate', async (request, reply) => {
    const { projectId } = request.body;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const stats = await databaseService.migrateFromFiles(project.path, project.id);
    return { success: true, ...stats };
  });
}
