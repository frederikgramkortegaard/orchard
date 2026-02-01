/**
 * Debug Log Service
 *
 * Provides in-memory circular buffer storage for debug logs from various sources
 * including server, terminal daemon, orchestrator, and AI API requests/responses.
 */

export interface DebugLogEntry {
  id: string;
  timestamp: string;
  source: 'server' | 'daemon' | 'orchestrator' | 'ai-api';
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

export interface AIRequestLogEntry {
  id: string;
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

class CircularBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(item: T): void {
    this.buffer.push(item);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  getAll(): T[] {
    return [...this.buffer];
  }

  getRecent(count: number): T[] {
    return this.buffer.slice(-count);
  }

  clear(): void {
    this.buffer = [];
  }

  size(): number {
    return this.buffer.length;
  }
}

class DebugLogService {
  private logs = new CircularBuffer<DebugLogEntry>(1000);
  private aiRequests = new CircularBuffer<AIRequestLogEntry>(500);
  private idCounter = 0;

  /**
   * Add a general debug log entry
   */
  log(
    source: DebugLogEntry['source'],
    level: DebugLogEntry['level'],
    message: string,
    details?: Record<string, unknown>
  ): DebugLogEntry {
    const entry: DebugLogEntry = {
      id: `log-${++this.idCounter}`,
      timestamp: new Date().toISOString(),
      source,
      level,
      message,
      details,
    };
    this.logs.push(entry);
    return entry;
  }

  /**
   * Convenience methods for different log levels
   */
  debug(source: DebugLogEntry['source'], message: string, details?: Record<string, unknown>): DebugLogEntry {
    return this.log(source, 'debug', message, details);
  }

  info(source: DebugLogEntry['source'], message: string, details?: Record<string, unknown>): DebugLogEntry {
    return this.log(source, 'info', message, details);
  }

  warn(source: DebugLogEntry['source'], message: string, details?: Record<string, unknown>): DebugLogEntry {
    return this.log(source, 'warn', message, details);
  }

  error(source: DebugLogEntry['source'], message: string, details?: Record<string, unknown>): DebugLogEntry {
    return this.log(source, 'error', message, details);
  }

  /**
   * Log an AI API request
   */
  logAIRequest(data: Omit<AIRequestLogEntry, 'id' | 'timestamp' | 'type'>): AIRequestLogEntry {
    const entry: AIRequestLogEntry = {
      id: `ai-req-${++this.idCounter}`,
      timestamp: new Date().toISOString(),
      type: 'request',
      ...data,
    };
    this.aiRequests.push(entry);
    return entry;
  }

  /**
   * Log an AI API response
   */
  logAIResponse(data: Omit<AIRequestLogEntry, 'id' | 'timestamp' | 'type'>): AIRequestLogEntry {
    const entry: AIRequestLogEntry = {
      id: `ai-resp-${++this.idCounter}`,
      timestamp: new Date().toISOString(),
      type: 'response',
      ...data,
    };
    this.aiRequests.push(entry);
    return entry;
  }

  /**
   * Get all logs, optionally filtered by source
   */
  getLogs(source?: DebugLogEntry['source'], limit?: number): DebugLogEntry[] {
    let logs = this.logs.getAll();

    if (source) {
      logs = logs.filter(l => l.source === source);
    }

    if (limit) {
      logs = logs.slice(-limit);
    }

    return logs;
  }

  /**
   * Get recent logs
   */
  getRecentLogs(count: number = 100): DebugLogEntry[] {
    return this.logs.getRecent(count);
  }

  /**
   * Get all AI request/response logs
   */
  getAIRequests(limit?: number): AIRequestLogEntry[] {
    if (limit) {
      return this.aiRequests.getRecent(limit);
    }
    return this.aiRequests.getAll();
  }

  /**
   * Get recent AI requests
   */
  getRecentAIRequests(count: number = 50): AIRequestLogEntry[] {
    return this.aiRequests.getRecent(count);
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs.clear();
  }

  /**
   * Clear AI request logs
   */
  clearAIRequests(): void {
    this.aiRequests.clear();
  }

  /**
   * Get stats about stored logs
   */
  getStats(): { logCount: number; aiRequestCount: number } {
    return {
      logCount: this.logs.size(),
      aiRequestCount: this.aiRequests.size(),
    };
  }
}

export const debugLogService = new DebugLogService();
