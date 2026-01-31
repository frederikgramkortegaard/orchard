import { EventEmitter } from 'node:events';
import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectService } from './project.service.js';
import { daemonClient } from '../pty/daemon-client.js';

/**
 * Pattern types that can be detected in terminal output
 */
export type PatternType = 'TASK_COMPLETE' | 'QUESTION' | 'ERROR' | 'RATE_LIMIT' | 'READY';

/**
 * A detected pattern in terminal output
 */
export interface DetectedPattern {
  id: string;
  type: PatternType;
  sessionId: string;
  worktreeId: string;
  projectId: string;
  timestamp: string;
  content: string;
  handled: boolean;
  handledAt?: string;
}

interface HandledMessagesFile {
  version: number;
  messages: DetectedPattern[];
  lastUpdated: string;
}

/**
 * Pattern definitions for detecting terminal output
 */
const PATTERNS: Array<{ type: PatternType; patterns: RegExp[] }> = [
  {
    type: 'TASK_COMPLETE',
    patterns: [
      /TASK[\s_-]*COMPLETE/i,
      /Task completed successfully/i,
      /All done!/i,
      /Finished!/i,
      /completed the task/i,
    ],
  },
  {
    type: 'QUESTION',
    patterns: [
      /\?[\s]*$/m,
      /Would you like me to/i,
      /Should I/i,
      /Do you want/i,
      /Please confirm/i,
      /waiting for.*input/i,
    ],
  },
  {
    type: 'ERROR',
    patterns: [
      /error:/i,
      /Error:/,
      /fatal:/i,
      /FAILED/,
      /exception:/i,
      /panic:/i,
      /Traceback \(most recent call last\)/,
    ],
  },
  {
    type: 'RATE_LIMIT',
    patterns: [
      /rate.?limit/i,
      /too many requests/i,
      /429/,
      /throttl/i,
    ],
  },
  {
    type: 'READY',
    patterns: [
      /How can I help/i,
      /What would you like/i,
      /Ready for input/i,
      /^>\s*$/m,
    ],
  },
];

/**
 * Terminal Monitor Service
 *
 * Responsibilities:
 * - Subscribe to terminal output from daemon
 * - Parse output for TASK_COMPLETE, QUESTION, ERROR patterns
 * - Emit events when patterns are detected
 * - Track handled messages in .orchard/handled-messages.json
 */
class TerminalMonitorService extends EventEmitter {
  private initialized = false;
  private handledMessages = new Map<string, DetectedPattern>();
  private outputBuffers = new Map<string, string>(); // sessionId -> buffer
  private monitoredSessions = new Set<string>();

  // Debounce pattern detection to avoid duplicates
  private lastDetection = new Map<string, number>(); // key -> timestamp
  private readonly DETECTION_COOLDOWN_MS = 5000;

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load handled messages from all projects
    const projects = projectService.getAllProjects();
    for (const project of projects) {
      await this.loadHandledMessages(project.id);
    }

    // Listen for terminal data from daemon
    daemonClient.on('terminal:data', (msg: any) => {
      this.handleTerminalData(msg.sessionId, msg.data);
    });

    // Listen for task complete events from daemon (already parsed)
    daemonClient.on('task-complete', (msg: any) => {
      this.handleExternalTaskComplete(msg.sessionId, msg.worktreeId);
    });

    // Listen for rate limit events
    daemonClient.on('rate-limited', (msg: any) => {
      this.handleRateLimited(msg.rateLimit.sessionId, msg.rateLimit.worktreeId);
    });

    this.initialized = true;
    console.log('[TerminalMonitor] Initialized');
  }

  /**
   * Get handled messages file path for a project
   */
  private getHandledMessagesPath(projectId: string): string | null {
    const project = projectService.getProject(projectId);
    if (!project) return null;
    return join(project.path, '.orchard', 'handled-messages.json');
  }

  /**
   * Load handled messages from disk
   */
  private async loadHandledMessages(projectId: string): Promise<void> {
    const filePath = this.getHandledMessagesPath(projectId);
    if (!filePath || !existsSync(filePath)) return;

    try {
      const content = await readFile(filePath, 'utf-8');
      const data: HandledMessagesFile = JSON.parse(content);

      for (const msg of data.messages) {
        this.handledMessages.set(msg.id, msg);
      }

      console.log(`[TerminalMonitor] Loaded ${data.messages.length} handled messages for ${projectId}`);
    } catch (error) {
      console.error(`[TerminalMonitor] Error loading handled messages for ${projectId}:`, error);
    }
  }

  /**
   * Save handled messages to disk
   */
  private async saveHandledMessages(projectId: string): Promise<void> {
    const filePath = this.getHandledMessagesPath(projectId);
    if (!filePath) return;

    const projectMessages = Array.from(this.handledMessages.values())
      .filter(m => m.projectId === projectId);

    // Only keep recent messages (last 24 hours)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentMessages = projectMessages.filter(m =>
      new Date(m.timestamp).getTime() > cutoff
    );

    const data: HandledMessagesFile = {
      version: 1,
      messages: recentMessages,
      lastUpdated: new Date().toISOString(),
    };

    // Ensure directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Atomic write
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    try {
      await writeFile(tempPath, JSON.stringify(data, null, 2));
      await rename(tempPath, filePath);
    } catch (error) {
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup error
      }
      throw error;
    }
  }

  /**
   * Start monitoring a session
   */
  startMonitoring(sessionId: string, worktreeId: string, projectId: string): void {
    this.monitoredSessions.add(sessionId);
    this.outputBuffers.set(sessionId, '');

    // Store session metadata for later lookup
    const metaKey = `meta:${sessionId}`;
    (this as any)[metaKey] = { worktreeId, projectId };

    console.log(`[TerminalMonitor] Started monitoring session ${sessionId}`);
  }

  /**
   * Stop monitoring a session
   */
  stopMonitoring(sessionId: string): void {
    this.monitoredSessions.delete(sessionId);
    this.outputBuffers.delete(sessionId);

    const metaKey = `meta:${sessionId}`;
    delete (this as any)[metaKey];

    console.log(`[TerminalMonitor] Stopped monitoring session ${sessionId}`);
  }

  /**
   * Handle incoming terminal data
   */
  private handleTerminalData(sessionId: string, data: string): void {
    if (!this.monitoredSessions.has(sessionId)) return;

    // Get session metadata
    const metaKey = `meta:${sessionId}`;
    const meta = (this as any)[metaKey];
    if (!meta) return;

    // Append to buffer (keep last 4KB)
    let buffer = this.outputBuffers.get(sessionId) || '';
    buffer += data;
    if (buffer.length > 4096) {
      buffer = buffer.slice(-4096);
    }
    this.outputBuffers.set(sessionId, buffer);

    // Check for patterns
    this.detectPatterns(sessionId, meta.worktreeId, meta.projectId, buffer);
  }

  /**
   * Detect patterns in terminal output
   */
  private detectPatterns(
    sessionId: string,
    worktreeId: string,
    projectId: string,
    buffer: string
  ): void {
    // Strip ANSI escape codes for pattern matching
    const cleanBuffer = this.stripAnsi(buffer);

    for (const { type, patterns } of PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(cleanBuffer)) {
          // Check cooldown to avoid duplicate detections
          const key = `${sessionId}:${type}`;
          const lastTime = this.lastDetection.get(key) || 0;
          const now = Date.now();

          if (now - lastTime < this.DETECTION_COOLDOWN_MS) {
            continue;
          }

          this.lastDetection.set(key, now);

          // Create detection record
          const detection = this.createDetection(
            type,
            sessionId,
            worktreeId,
            projectId,
            cleanBuffer.slice(-500) // Last 500 chars for context
          );

          // Emit event
          this.emit('pattern', detection);
          this.emit(`pattern:${type.toLowerCase()}`, detection);

          console.log(`[TerminalMonitor] Detected ${type} in session ${sessionId}`);

          // Only detect one pattern per check
          return;
        }
      }
    }
  }

  /**
   * Strip ANSI escape codes from text
   */
  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }

  /**
   * Create a detection record
   */
  private createDetection(
    type: PatternType,
    sessionId: string,
    worktreeId: string,
    projectId: string,
    content: string
  ): DetectedPattern {
    return {
      id: randomUUID(),
      type,
      sessionId,
      worktreeId,
      projectId,
      timestamp: new Date().toISOString(),
      content,
      handled: false,
    };
  }

  /**
   * Handle external task complete event (from daemon)
   */
  private handleExternalTaskComplete(sessionId: string, worktreeId: string): void {
    // Find project from worktreeId
    const projects = projectService.getAllProjects();
    let projectId = '';

    for (const project of projects) {
      // This is a simplified lookup - in practice you'd use worktreeService
      if (worktreeId.includes(project.id) || project.path.includes(worktreeId)) {
        projectId = project.id;
        break;
      }
    }

    const detection = this.createDetection(
      'TASK_COMPLETE',
      sessionId,
      worktreeId,
      projectId,
      'Task completion detected by daemon'
    );

    this.emit('pattern', detection);
    this.emit('pattern:task_complete', detection);
  }

  /**
   * Handle rate limited event
   */
  private handleRateLimited(sessionId: string, worktreeId: string): void {
    const projects = projectService.getAllProjects();
    let projectId = '';

    for (const project of projects) {
      if (worktreeId.includes(project.id) || project.path.includes(worktreeId)) {
        projectId = project.id;
        break;
      }
    }

    const detection = this.createDetection(
      'RATE_LIMIT',
      sessionId,
      worktreeId,
      projectId,
      'Rate limit detected by daemon'
    );

    this.emit('pattern', detection);
    this.emit('pattern:rate_limit', detection);
  }

  /**
   * Mark a detection as handled
   */
  async markHandled(detectionId: string, projectId: string): Promise<boolean> {
    const detection = this.handledMessages.get(detectionId);

    // If not in handled map, create a placeholder
    const record = detection || {
      id: detectionId,
      type: 'TASK_COMPLETE' as PatternType,
      sessionId: '',
      worktreeId: '',
      projectId,
      timestamp: new Date().toISOString(),
      content: '',
      handled: true,
      handledAt: new Date().toISOString(),
    };

    record.handled = true;
    record.handledAt = new Date().toISOString();

    this.handledMessages.set(detectionId, record);
    await this.saveHandledMessages(projectId);

    console.log(`[TerminalMonitor] Marked ${detectionId} as handled`);
    return true;
  }

  /**
   * Check if a detection has been handled
   */
  isHandled(detectionId: string): boolean {
    const msg = this.handledMessages.get(detectionId);
    return msg?.handled || false;
  }

  /**
   * Get unhandled detections for a project
   */
  getUnhandledDetections(projectId: string): DetectedPattern[] {
    return Array.from(this.handledMessages.values())
      .filter(m => m.projectId === projectId && !m.handled);
  }

  /**
   * Get recent detections (handled or not)
   */
  getRecentDetections(projectId: string, since?: Date): DetectedPattern[] {
    const cutoff = since || new Date(Date.now() - 60 * 60 * 1000); // Default: last hour

    return Array.from(this.handledMessages.values())
      .filter(m =>
        m.projectId === projectId &&
        new Date(m.timestamp) >= cutoff
      )
      .sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
  }

  /**
   * Clean up old handled messages
   */
  async cleanup(projectId: string): Promise<number> {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    let removed = 0;

    for (const [id, msg] of this.handledMessages) {
      if (msg.projectId === projectId &&
          msg.handled &&
          new Date(msg.timestamp).getTime() < cutoff) {
        this.handledMessages.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      await this.saveHandledMessages(projectId);
      console.log(`[TerminalMonitor] Cleaned up ${removed} old messages for ${projectId}`);
    }

    return removed;
  }
}

export const terminalMonitorService = new TerminalMonitorService();
