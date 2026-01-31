import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { projectService } from './project.service.js';

export interface QueuedMessage {
  id: string;
  projectId: string;
  content: string;
  timestamp: string;
  read: boolean;
}

const MESSAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

class MessageQueueService {
  private messagesByProject = new Map<string, QueuedMessage[]>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load messages for all known projects
    const projects = projectService.getAllProjects();
    for (const project of projects) {
      await this.loadMessagesForProject(project.id);
    }

    this.initialized = true;
    console.log('[MessageQueue] Service initialized');
  }

  private getQueuePath(projectId: string): string | null {
    const project = projectService.getProject(projectId);
    if (!project) return null;
    return join(project.path, '.orchard', 'message-queue.json');
  }

  private async ensureOrchardDir(projectId: string): Promise<string | null> {
    const project = projectService.getProject(projectId);
    if (!project) return null;

    const orchardDir = join(project.path, '.orchard');
    if (!existsSync(orchardDir)) {
      await mkdir(orchardDir, { recursive: true });
    }
    return orchardDir;
  }

  private cleanupOldMessages(messages: QueuedMessage[]): QueuedMessage[] {
    const cutoff = Date.now() - MESSAGE_MAX_AGE_MS;
    const cleaned = messages.filter(msg => {
      const msgTime = new Date(msg.timestamp).getTime();
      return msgTime > cutoff;
    });

    const removed = messages.length - cleaned.length;
    if (removed > 0) {
      console.log(`[MessageQueue] Cleaned up ${removed} old messages`);
    }

    return cleaned;
  }

  private async loadMessagesForProject(projectId: string): Promise<QueuedMessage[]> {
    const queuePath = this.getQueuePath(projectId);
    if (!queuePath || !existsSync(queuePath)) {
      this.messagesByProject.set(projectId, []);
      return [];
    }

    try {
      const data = await readFile(queuePath, 'utf-8');
      let messages: QueuedMessage[] = JSON.parse(data);

      // Clean up old messages on load
      messages = this.cleanupOldMessages(messages);

      // Save cleaned list back if any were removed
      this.messagesByProject.set(projectId, messages);
      await this.saveMessagesForProject(projectId);

      console.log(`[MessageQueue] Loaded ${messages.length} messages for project ${projectId}`);
      return messages;
    } catch (err) {
      console.error(`[MessageQueue] Failed to load messages for ${projectId}:`, err);
      this.messagesByProject.set(projectId, []);
      return [];
    }
  }

  private async saveMessagesForProject(projectId: string): Promise<void> {
    const queuePath = this.getQueuePath(projectId);
    if (!queuePath) return;

    await this.ensureOrchardDir(projectId);

    const messages = this.messagesByProject.get(projectId) || [];
    const content = JSON.stringify(messages, null, 2);

    // Atomic write: write to temp file then rename
    const tempPath = `${queuePath}.tmp.${Date.now()}`;
    try {
      await writeFile(tempPath, content, 'utf-8');
      await rename(tempPath, queuePath);
    } catch (err) {
      // Clean up temp file if rename failed
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }

  async getMessages(projectId: string): Promise<QueuedMessage[]> {
    if (!this.messagesByProject.has(projectId)) {
      await this.loadMessagesForProject(projectId);
    }
    return this.messagesByProject.get(projectId) || [];
  }

  async getUnreadMessages(projectId: string): Promise<QueuedMessage[]> {
    const messages = await this.getMessages(projectId);
    return messages.filter(m => !m.read);
  }

  async addMessage(projectId: string, content: string): Promise<QueuedMessage> {
    if (!this.messagesByProject.has(projectId)) {
      await this.loadMessagesForProject(projectId);
    }

    const messages = this.messagesByProject.get(projectId) || [];
    const newMessage: QueuedMessage = {
      id: crypto.randomUUID(),
      projectId,
      content,
      timestamp: new Date().toISOString(),
      read: false,
    };

    messages.push(newMessage);
    this.messagesByProject.set(projectId, messages);
    await this.saveMessagesForProject(projectId);

    return newMessage;
  }

  async markAsRead(projectId: string, messageIds?: string[]): Promise<number> {
    const messages = await this.getMessages(projectId);
    let marked = 0;

    for (const msg of messages) {
      if (!msg.read) {
        if (!messageIds || messageIds.includes(msg.id)) {
          msg.read = true;
          marked++;
        }
      }
    }

    if (marked > 0) {
      await this.saveMessagesForProject(projectId);
    }

    return marked;
  }

  async markAllAsRead(projectId: string): Promise<number> {
    return this.markAsRead(projectId);
  }

  async clearReadMessages(projectId: string): Promise<number> {
    const messages = await this.getMessages(projectId);
    const unread = messages.filter(m => !m.read);
    const cleared = messages.length - unread.length;

    if (cleared > 0) {
      this.messagesByProject.set(projectId, unread);
      await this.saveMessagesForProject(projectId);
    }

    return cleared;
  }

  async deleteMessage(projectId: string, messageId: string): Promise<boolean> {
    const messages = await this.getMessages(projectId);
    const idx = messages.findIndex(m => m.id === messageId);

    if (idx === -1) return false;

    messages.splice(idx, 1);
    await this.saveMessagesForProject(projectId);
    return true;
  }

  async cleanupAllProjects(): Promise<void> {
    for (const [projectId, messages] of this.messagesByProject) {
      const cleaned = this.cleanupOldMessages(messages);
      if (cleaned.length !== messages.length) {
        this.messagesByProject.set(projectId, cleaned);
        await this.saveMessagesForProject(projectId);
      }
    }
  }
}

export const messageQueueService = new MessageQueueService();
