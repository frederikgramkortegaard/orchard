import type { FastifyInstance } from 'fastify';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { projectService } from '../services/project.service.js';

interface ChatMessage {
  id: string;
  projectId: string;
  text: string;
  timestamp: string;
  from: 'user' | 'orchestrator';
  replyTo?: string; // ID of message being replied to
}

interface QueuedMessage {
  id: string;
  projectId: string;
  text: string;
  timestamp: string;
  processed: boolean;
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

async function getMessageQueuePath(projectId: string): Promise<string | null> {
  const orchardDir = await getOrchardDir(projectId);
  if (!orchardDir) return null;
  return join(orchardDir, 'message-queue.json');
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
  await writeFile(chatPath, JSON.stringify(messages, null, 2));
}

async function loadMessages(projectId: string): Promise<QueuedMessage[]> {
  const queuePath = await getMessageQueuePath(projectId);
  if (!queuePath || !existsSync(queuePath)) return [];

  try {
    const data = await readFile(queuePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveMessages(projectId: string, messages: QueuedMessage[]): Promise<void> {
  const queuePath = await getMessageQueuePath(projectId);
  if (!queuePath) return;
  await writeFile(queuePath, JSON.stringify(messages, null, 2));
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
    Body: { projectId: string; text: string };
  }>('/messages', async (request, reply) => {
    const { projectId, text } = request.body;

    if (!projectId || !text) {
      return reply.status(400).send({ error: 'projectId and text required' });
    }

    const messages = await loadMessages(projectId);
    const newMessage: QueuedMessage = {
      id: crypto.randomUUID(),
      projectId,
      text,
      timestamp: new Date().toISOString(),
      processed: false,
    };

    messages.push(newMessage);
    await saveMessages(projectId, messages);

    return { success: true, message: newMessage };
  });

  // Get unprocessed messages for a project
  fastify.get<{
    Querystring: { projectId: string; markProcessed?: string };
  }>('/messages', async (request, reply) => {
    const { projectId, markProcessed } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const messages = await loadMessages(projectId);
    const unprocessed = messages.filter(m => !m.processed);

    // Optionally mark as processed
    if (markProcessed === 'true' && unprocessed.length > 0) {
      for (const msg of messages) {
        if (!msg.processed) msg.processed = true;
      }
      await saveMessages(projectId, messages);
    }

    return unprocessed;
  });

  // Clear processed messages
  fastify.delete<{
    Querystring: { projectId: string };
  }>('/messages', async (request, reply) => {
    const { projectId } = request.query;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId required' });
    }

    const messages = await loadMessages(projectId);
    const unprocessed = messages.filter(m => !m.processed);
    await saveMessages(projectId, unprocessed);

    return { success: true, cleared: messages.length - unprocessed.length };
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
