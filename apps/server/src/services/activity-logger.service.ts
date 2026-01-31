import { existsSync } from 'fs';
import { appendFile, readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { projectService } from './project.service.js';

export type ActivityEntryType = 'action' | 'event' | 'decision' | 'error' | 'tick';
export type ActivityCategory = 'worktree' | 'agent' | 'user' | 'system' | 'orchestrator';

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  type: ActivityEntryType;
  category: ActivityCategory;
  summary: string;
  details: Record<string, unknown>;
  correlationId: string;
  duration?: number;
}

export interface LogFilter {
  since?: Date;
  until?: Date;
  type?: ActivityEntryType;
  category?: ActivityCategory;
  correlationId?: string;
  limit?: number;
}

type LogSubscriber = (entry: ActivityLogEntry) => void;

class ActivityLoggerService {
  private eventEmitter = new EventEmitter();
  private logPath: string | null = null;
  private writeQueue: ActivityLogEntry[] = [];
  private isWriting = false;

  // Get the log path for the first registered project
  private getLogPath(): string {
    if (this.logPath) return this.logPath;

    const projects = projectService.getAllProjects();
    if (projects.length === 0) {
      // Default fallback path
      return join(process.cwd(), '.orchard', 'activity-log.jsonl');
    }

    this.logPath = join(projects[0].path, '.orchard', 'activity-log.jsonl');
    return this.logPath;
  }

  // Set the log path explicitly for a specific project
  setLogPath(projectPath: string): void {
    this.logPath = join(projectPath, '.orchard', 'activity-log.jsonl');
  }

  async log(entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>): Promise<ActivityLogEntry> {
    const fullEntry: ActivityLogEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    // Add to write queue
    this.writeQueue.push(fullEntry);
    this.processWriteQueue();

    // Emit to subscribers
    this.eventEmitter.emit('entry', fullEntry);

    return fullEntry;
  }

  private async processWriteQueue(): Promise<void> {
    if (this.isWriting || this.writeQueue.length === 0) return;

    this.isWriting = true;
    const entriesToWrite = [...this.writeQueue];
    this.writeQueue = [];

    try {
      const logPath = this.getLogPath();
      const dir = dirname(logPath);

      // Ensure directory exists
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      // Append all entries as JSONL
      const lines = entriesToWrite.map(e => JSON.stringify(e)).join('\n') + '\n';
      await appendFile(logPath, lines);
    } catch (error) {
      console.error('Error writing to activity log:', error);
      // Re-queue failed entries
      this.writeQueue = [...entriesToWrite, ...this.writeQueue];
    } finally {
      this.isWriting = false;
      // Process any entries that accumulated while we were writing
      if (this.writeQueue.length > 0) {
        this.processWriteQueue();
      }
    }
  }

  async query(filter: LogFilter = {}): Promise<ActivityLogEntry[]> {
    const logPath = this.getLogPath();

    if (!existsSync(logPath)) {
      return [];
    }

    try {
      const content = await readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      let entries: ActivityLogEntry[] = lines.map(line => {
        try {
          return JSON.parse(line) as ActivityLogEntry;
        } catch {
          return null;
        }
      }).filter((e): e is ActivityLogEntry => e !== null);

      // Apply filters
      if (filter.since) {
        const sinceTime = filter.since.getTime();
        entries = entries.filter(e => new Date(e.timestamp).getTime() >= sinceTime);
      }

      if (filter.until) {
        const untilTime = filter.until.getTime();
        entries = entries.filter(e => new Date(e.timestamp).getTime() <= untilTime);
      }

      if (filter.type) {
        entries = entries.filter(e => e.type === filter.type);
      }

      if (filter.category) {
        entries = entries.filter(e => e.category === filter.category);
      }

      if (filter.correlationId) {
        entries = entries.filter(e => e.correlationId === filter.correlationId);
      }

      // Sort by timestamp descending (most recent first)
      entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply limit
      if (filter.limit && filter.limit > 0) {
        entries = entries.slice(0, filter.limit);
      }

      return entries;
    } catch (error) {
      console.error('Error querying activity log:', error);
      return [];
    }
  }

  async export(format: 'json' | 'csv' | 'text'): Promise<string> {
    const entries = await this.query();

    switch (format) {
      case 'json':
        return JSON.stringify(entries, null, 2);

      case 'csv': {
        const headers = ['id', 'timestamp', 'type', 'category', 'summary', 'correlationId', 'duration'];
        const rows = entries.map(e => [
          e.id,
          e.timestamp,
          e.type,
          e.category,
          `"${e.summary.replace(/"/g, '""')}"`,
          e.correlationId,
          e.duration?.toString() || '',
        ].join(','));
        return [headers.join(','), ...rows].join('\n');
      }

      case 'text': {
        return entries.map(e => {
          const duration = e.duration ? ` (${e.duration}ms)` : '';
          return `[${e.timestamp}] [${e.type.toUpperCase()}] [${e.category}] ${e.summary}${duration}`;
        }).join('\n');
      }

      default:
        return JSON.stringify(entries, null, 2);
    }
  }

  subscribe(callback: LogSubscriber): () => void {
    this.eventEmitter.on('entry', callback);
    return () => {
      this.eventEmitter.off('entry', callback);
    };
  }

  // Clear the log file (for testing or maintenance)
  async clear(): Promise<void> {
    const logPath = this.getLogPath();
    if (existsSync(logPath)) {
      await writeFile(logPath, '');
    }
  }

  // Get the count of entries
  async getEntryCount(): Promise<number> {
    const logPath = this.getLogPath();
    if (!existsSync(logPath)) {
      return 0;
    }

    try {
      const content = await readFile(logPath, 'utf-8');
      return content.trim().split('\n').filter(Boolean).length;
    } catch {
      return 0;
    }
  }
}

export const activityLoggerService = new ActivityLoggerService();
