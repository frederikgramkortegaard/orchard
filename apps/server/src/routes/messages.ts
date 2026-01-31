import type { FastifyInstance } from 'fastify';
import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { projectService } from '../services/project.service.js';
import { messageQueueService, type QueuedMessage } from '../services/message-queue.service.js';

interface ChatMessage {
  id: string;
  projectId: string;
  text: string;
  timestamp: string;
  from: 'user' | 'orchestrator';
  replyTo?: string; // ID of message being replied to
}

async function getOrchardDir(projectId: string): Promise<string | null> {
  const project = projectService.getProject(projectId);
  if (!project) return null;

  const orchardDir = join(project.path, '.orchard');
  if (!existsSync(orchardDir)) {
    await mkdir(orchardDir, { recursive: true });
  }
  return orchardDir;
}

async function getChatPath(projectId: string): Promise<string | null> {
  const orchardDir = await getOrchardDir(projectId);
  if (!orchardDir) return null;
  return join(orchardDir, 'chat.json');
}

async function loadChat(projectId: string): Promise<ChatMessage[]> {
  const chatPath = await getChatPath(projectId);
  if (!chatPath || !existsSync(chatPath)) return [];

  try {
    const data = await readFile(chatPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveChat(projectId: string, messages: ChatMessage[]): Promise<void> {
  const chatPath = await getChatPath(projectId);
  if (!chatPath) return;

  // Atomic write: write to temp file then rename
  const tempPath = `${chatPath}.tmp.${Date.now()}`;
  try {
    await writeFile(tempPath, JSON.stringify(messages, null, 2), 'utf-8');
    await rename(tempPath, chatPath);
  } catch (err) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

export async function messagesRoutes(fastify: FastifyInstance) {
  // Get orchestrator activity log
  fastify.get<{
    Querystring: { projectId: string; lines?: string };
  }>('/orchestrator/log', async (request, reply) => {
    const { projectId, lines = '50' } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const logPath = join(project.path, '.orchard', 'orchestrator-log.txt');
    if (!existsSync(logPath)) {
      return { lines: [], lastModified: null };
    }

    try {
      const content = await readFile(logPath, 'utf-8');
      const allLines = content.trim().split('\n').filter(Boolean);
      const numLines = parseInt(lines, 10) || 50;
      const recentLines = allLines.slice(-numLines);

      return {
        lines: recentLines,
        total: allLines.length,
        lastModified: new Date().toISOString(),
      };
    } catch {
      return { lines: [], lastModified: null };
    }
  });

  // Append to orchestrator log
  fastify.post<{
    Body: { projectId: string; message: string };
  }>('/orchestrator/log', async (request, reply) => {
    const { projectId, message } = request.body;

    if (!projectId || !message) {
      return reply.status(400).send({ error: 'projectId and message required' });
    }

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const orchardDir = join(project.path, '.orchard');
    if (!existsSync(orchardDir)) {
      await mkdir(orchardDir, { recursive: true });
    }

    const logPath = join(orchardDir, 'orchestrator-log.txt');
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;

    try {
      const { appendFile } = await import('fs/promises');
      await appendFile(logPath, logLine);
      return { success: true, timestamp };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Queue a message for the orchestrator
  fastify.post<{
    Body: { projectId: string; text?: string; content?: string };
  }>('/messages', async (request, reply) => {
    const { projectId, text, content } = request.body;
    const messageContent = content || text; // Support both field names

    if (!projectId || !messageContent) {
      return reply.status(400).send({ error: 'projectId and content (or text) required' });
    }

    const newMessage = await messageQueueService.addMessage(projectId, messageContent);

    // Return in both formats for backward compatibility
    return {
      success: true,
      message: {
        ...newMessage,
        text: newMessage.content, // backward compat
        processed: newMessage.read, // backward compat
      },
    };
  });

  // Get unread messages for a project
  fastify.get<{
    Querystring: { projectId: string; markProcessed?: string; markRead?: string };
  }>('/messages', async (request, reply) => {
    const { projectId, markProcessed, markRead } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const unread = await messageQueueService.getUnreadMessages(projectId);

    // Optionally mark as read
    if ((markProcessed === 'true' || markRead === 'true') && unread.length > 0) {
      await messageQueueService.markAllAsRead(projectId);
    }

    // Return in backward compatible format
    return unread.map(m => ({
      ...m,
      text: m.content, // backward compat
      processed: m.read, // backward compat
    }));
  });

  // Clear read messages
  fastify.delete<{
    Querystring: { projectId: string };
  }>('/messages', async (request, reply) => {
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const cleared = await messageQueueService.clearReadMessages(projectId);
    return { success: true, cleared };
  });

  // Mark specific messages as read
  fastify.post<{
    Body: { projectId: string; messageIds?: string[] };
  }>('/messages/read', async (request, reply) => {
    const { projectId, messageIds } = request.body;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const marked = await messageQueueService.markAsRead(projectId, messageIds);
    return { success: true, marked };
  });

  // Get all messages (including read)
  fastify.get<{
    Querystring: { projectId: string };
  }>('/messages/all', async (request, reply) => {
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const messages = await messageQueueService.getMessages(projectId);
    return messages.map(m => ({
      ...m,
      text: m.content, // backward compat
      processed: m.read, // backward compat
    }));
  });

  // Get chat history
  fastify.get<{
    Querystring: { projectId: string; limit?: string };
  }>('/chat', async (request, reply) => {
    const { projectId, limit = '50' } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const chat = await loadChat(projectId);
    const numLimit = parseInt(limit, 10) || 50;
    return chat.slice(-numLimit);
  });

  // Send a chat message (from user or orchestrator)
  fastify.post<{
    Body: { projectId: string; text: string; from: 'user' | 'orchestrator'; replyTo?: string };
  }>('/chat', async (request, reply) => {
    const { projectId, text, from, replyTo } = request.body;

    if (!projectId || !text || !from) {
      return reply.status(400).send({ error: 'projectId, text, and from required' });
    }

    const chat = await loadChat(projectId);
    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      projectId,
      text,
      timestamp: new Date().toISOString(),
      from,
      replyTo,
    };

    chat.push(newMessage);
    await saveChat(projectId, chat);

    return { success: true, message: newMessage };
  });
}
