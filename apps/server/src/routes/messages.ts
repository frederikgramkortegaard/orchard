import type { FastifyInstance } from 'fastify';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { projectService } from '../services/project.service.js';

interface QueuedMessage {
  id: string;
  projectId: string;
  text: string;
  timestamp: string;
  processed: boolean;
}

async function getMessageQueuePath(projectId: string): Promise<string | null> {
  const project = projectService.getProject(projectId);
  if (!project) return null;

  const orchardDir = join(project.path, '.orchard');
  if (!existsSync(orchardDir)) {
    await mkdir(orchardDir, { recursive: true });
  }
  return join(orchardDir, 'message-queue.json');
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
}
