/**
 * Debug Log Service
 *
 * Provides SQLite-backed storage for debug logs from various sources
 * including server, terminal daemon, orchestrator, and AI API requests/responses.
 */

import { databaseService } from './database.service.js';
import { projectService } from './project.service.js';

export interface DebugLogEntry {
  id: number;
  timestamp: string;
  source: 'server' | 'daemon' | 'orchestrator' | 'ai-api';
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

export interface AIRequestLogEntry {
  id: number;
  timestamp: string;
  type: 'request' | 'response';
  tickNumber?: number;
  model?: string;
  provider?: string;
  messages?: Array<{ role: string; content: string }>;
  toolCalls?: Array<{ name: string; arguments: string }>;
  content?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  finishReason?: string;
  error?: string;
  durationMs?: number;
  correlationId?: string;
}

class DebugLogService {
  private getProjectPath(): string | null {
    const projects = projectService.getAllProjects();
    if (projects.length === 0) return null;
    return projects[0].path;
  }

  /**
   * Add a general debug log entry
   */
  log(
    source: DebugLogEntry['source'],
    level: DebugLogEntry['level'],
    message: string,
    details?: Record<string, unknown>
  ): void {
    const projectPath = this.getProjectPath();
    if (!projectPath) return;

    databaseService.addDebugLog(projectPath, {
      source,
      level,
      message,
      details,
    });
  }

  /**
   * Convenience methods for different log levels
   */
  debug(source: DebugLogEntry['source'], message: string, details?: Record<string, unknown>): void {
    this.log(source, 'debug', message, details);
  }

  info(source: DebugLogEntry['source'], message: string, details?: Record<string, unknown>): void {
    this.log(source, 'info', message, details);
  }

  warn(source: DebugLogEntry['source'], message: string, details?: Record<string, unknown>): void {
    this.log(source, 'warn', message, details);
  }

  error(source: DebugLogEntry['source'], message: string, details?: Record<string, unknown>): void {
    this.log(source, 'error', message, details);
  }

  /**
   * Log an AI API request
   */
  logAIRequest(data: Omit<AIRequestLogEntry, 'id' | 'timestamp' | 'type'>): void {
    const projectPath = this.getProjectPath();
    if (!projectPath) return;

    databaseService.addAIRequest(projectPath, {
      type: 'request',
      ...data,
    });
  }

  /**
   * Log an AI API response
   */
  logAIResponse(data: Omit<AIRequestLogEntry, 'id' | 'timestamp' | 'type'>): void {
    const projectPath = this.getProjectPath();
    if (!projectPath) return;

    databaseService.addAIRequest(projectPath, {
      type: 'response',
      ...data,
    });
  }

  /**
   * Get all logs, optionally filtered by source
   */
  getLogs(source?: DebugLogEntry['source'], limit: number = 100): DebugLogEntry[] {
    const projectPath = this.getProjectPath();
    if (!projectPath) return [];

    let logs = databaseService.getDebugLogs(projectPath, limit) as DebugLogEntry[];

    if (source) {
      logs = logs.filter(l => l.source === source);
    }

    return logs;
  }

  /**
   * Get recent logs
   */
  getRecentLogs(count: number = 100): DebugLogEntry[] {
    return this.getLogs(undefined, count);
  }

  /**
   * Get all AI request/response logs
   */
  getAIRequests(limit: number = 100): AIRequestLogEntry[] {
    const projectPath = this.getProjectPath();
    if (!projectPath) return [];

    return databaseService.getAIRequests(projectPath, limit) as AIRequestLogEntry[];
  }

  /**
   * Get recent AI requests
   */
  getRecentAIRequests(count: number = 50): AIRequestLogEntry[] {
    return this.getAIRequests(count);
  }

  /**
   * Get stats about stored logs
   */
  getStats(): { logCount: number; aiRequestCount: number } {
    const projectPath = this.getProjectPath();
    if (!projectPath) return { logCount: 0, aiRequestCount: 0 };

    return databaseService.getDebugStats(projectPath);
  }
}

export const debugLogService = new DebugLogService();
