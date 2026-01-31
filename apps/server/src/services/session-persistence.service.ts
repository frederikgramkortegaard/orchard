import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { projectService } from './project.service.js';
import { daemonClient, type DaemonSession } from '../pty/daemon-client.js';

export interface PersistedSession {
  id: string;
  worktreeId: string;
  projectId: string;
  createdAt: string;
  command: string;
  cwd: string;
}

interface SessionsFile {
  version: number;
  sessions: PersistedSession[];
  lastUpdated: string;
}

/**
 * Session Persistence Service
 *
 * Responsibilities:
 * - Save active session IDs to .orchard/sessions.json
 * - Restore sessions on server restart
 * - Enforce 1 terminal per worktree (no duplicates)
 */
class SessionPersistenceService {
  private sessions = new Map<string, PersistedSession>();
  private initialized = false;

  /**
   * Initialize the service - load persisted sessions
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const projects = projectService.getAllProjects();
    for (const project of projects) {
      await this.loadSessionsForProject(project.id);
    }

    // Listen for daemon disconnects to handle session cleanup
    daemonClient.on('disconnected', () => {
      console.log('[SessionPersistence] Daemon disconnected - sessions may need recovery');
    });

    daemonClient.on('connected', async () => {
      console.log('[SessionPersistence] Daemon reconnected - validating sessions');
      await this.validateAllSessions();
    });

    this.initialized = true;
    console.log('[SessionPersistence] Initialized with', this.sessions.size, 'sessions');
  }

  /**
   * Get the sessions file path for a project
   */
  private getSessionsFilePath(projectId: string): string | null {
    const project = projectService.getProject(projectId);
    if (!project) return null;
    return join(project.path, '.orchard', 'sessions.json');
  }

  /**
   * Load sessions from disk for a specific project
   */
  private async loadSessionsForProject(projectId: string): Promise<void> {
    const filePath = this.getSessionsFilePath(projectId);
    if (!filePath || !existsSync(filePath)) return;

    try {
      const content = await readFile(filePath, 'utf-8');
      const data: SessionsFile = JSON.parse(content);

      for (const session of data.sessions) {
        // Use worktreeId as key to enforce uniqueness
        this.sessions.set(session.worktreeId, session);
      }

      console.log(`[SessionPersistence] Loaded ${data.sessions.length} sessions for project ${projectId}`);
    } catch (error) {
      console.error(`[SessionPersistence] Error loading sessions for ${projectId}:`, error);
    }
  }

  /**
   * Save sessions to disk for a specific project
   */
  private async saveSessionsForProject(projectId: string): Promise<void> {
    const filePath = this.getSessionsFilePath(projectId);
    if (!filePath) return;

    const projectSessions = Array.from(this.sessions.values())
      .filter(s => s.projectId === projectId);

    const data: SessionsFile = {
      version: 1,
      sessions: projectSessions,
      lastUpdated: new Date().toISOString(),
    };

    // Ensure directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Atomic write: write to temp file then rename
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
   * Register a new session - enforces 1 terminal per worktree
   */
  async registerSession(
    worktreeId: string,
    projectId: string,
    sessionId: string,
    command: string,
    cwd: string
  ): Promise<PersistedSession> {
    // Check for existing session for this worktree
    const existing = this.sessions.get(worktreeId);
    if (existing) {
      // Destroy existing session first
      console.log(`[SessionPersistence] Destroying existing session for worktree ${worktreeId}`);
      await this.destroySession(worktreeId);
    }

    const session: PersistedSession = {
      id: sessionId,
      worktreeId,
      projectId,
      createdAt: new Date().toISOString(),
      command,
      cwd,
    };

    this.sessions.set(worktreeId, session);
    await this.saveSessionsForProject(projectId);

    console.log(`[SessionPersistence] Registered session ${sessionId} for worktree ${worktreeId}`);
    return session;
  }

  /**
   * Remove a session
   */
  async unregisterSession(worktreeId: string): Promise<boolean> {
    const session = this.sessions.get(worktreeId);
    if (!session) return false;

    this.sessions.delete(worktreeId);
    await this.saveSessionsForProject(session.projectId);

    console.log(`[SessionPersistence] Unregistered session for worktree ${worktreeId}`);
    return true;
  }

  /**
   * Destroy a session (unregister and tell daemon to kill it)
   */
  async destroySession(worktreeId: string): Promise<boolean> {
    const session = this.sessions.get(worktreeId);
    if (!session) return false;

    try {
      await daemonClient.destroySession(session.id);
    } catch (error) {
      console.error(`[SessionPersistence] Error destroying session ${session.id}:`, error);
    }

    return await this.unregisterSession(worktreeId);
  }

  /**
   * Get session for a worktree
   */
  getSession(worktreeId: string): PersistedSession | undefined {
    return this.sessions.get(worktreeId);
  }

  /**
   * Get all sessions for a project
   */
  getSessionsForProject(projectId: string): PersistedSession[] {
    return Array.from(this.sessions.values())
      .filter(s => s.projectId === projectId);
  }

  /**
   * Check if a worktree has an active session
   */
  hasSession(worktreeId: string): boolean {
    return this.sessions.has(worktreeId);
  }

  /**
   * Validate all sessions against actual daemon sessions
   * Removes orphaned entries and identifies dead sessions
   */
  async validateAllSessions(): Promise<{
    valid: string[];
    orphaned: string[];
    dead: string[];
  }> {
    const result = {
      valid: [] as string[],
      orphaned: [] as string[],
      dead: [] as string[],
    };

    if (!daemonClient.isConnected()) {
      console.log('[SessionPersistence] Daemon not connected, skipping validation');
      return result;
    }

    try {
      const daemonSessions = await daemonClient.listSessions();
      const daemonSessionIds = new Set(daemonSessions.map(s => s.id));

      for (const [worktreeId, session] of this.sessions) {
        if (daemonSessionIds.has(session.id)) {
          result.valid.push(worktreeId);
        } else {
          // Session no longer exists in daemon
          result.dead.push(worktreeId);
          await this.unregisterSession(worktreeId);
        }
      }

      // Check for daemon sessions not in our registry (orphaned)
      for (const daemonSession of daemonSessions) {
        const inRegistry = Array.from(this.sessions.values())
          .some(s => s.id === daemonSession.id);
        if (!inRegistry && !daemonSession.worktreeId.startsWith('orchestrator-')) {
          result.orphaned.push(daemonSession.id);
        }
      }

      console.log(`[SessionPersistence] Validation complete: ${result.valid.length} valid, ${result.dead.length} dead, ${result.orphaned.length} orphaned`);
    } catch (error) {
      console.error('[SessionPersistence] Error validating sessions:', error);
    }

    return result;
  }

  /**
   * Restore a dead session - creates a new session for the worktree
   */
  async restoreSession(worktreeId: string): Promise<PersistedSession | null> {
    const oldSession = this.sessions.get(worktreeId);
    if (!oldSession) {
      console.log(`[SessionPersistence] No session to restore for ${worktreeId}`);
      return null;
    }

    const project = projectService.getProject(oldSession.projectId);
    if (!project) {
      console.log(`[SessionPersistence] Project not found for session restore: ${oldSession.projectId}`);
      return null;
    }

    try {
      // Create new session with same config
      const newSessionId = await daemonClient.createSession(
        worktreeId,
        project.path,
        oldSession.cwd,
        oldSession.command
      );

      // Update registry
      const newSession: PersistedSession = {
        ...oldSession,
        id: newSessionId,
        createdAt: new Date().toISOString(),
      };

      this.sessions.set(worktreeId, newSession);
      await this.saveSessionsForProject(oldSession.projectId);

      console.log(`[SessionPersistence] Restored session for ${worktreeId}: ${newSessionId}`);
      return newSession;
    } catch (error) {
      console.error(`[SessionPersistence] Failed to restore session for ${worktreeId}:`, error);
      return null;
    }
  }

  /**
   * Get dead sessions (persisted but not in daemon)
   */
  async getDeadSessions(): Promise<PersistedSession[]> {
    const dead: PersistedSession[] = [];

    if (!daemonClient.isConnected()) {
      return dead;
    }

    try {
      const daemonSessions = await daemonClient.listSessions();
      const daemonSessionIds = new Set(daemonSessions.map(s => s.id));

      for (const session of this.sessions.values()) {
        if (!daemonSessionIds.has(session.id)) {
          dead.push(session);
        }
      }
    } catch (error) {
      console.error('[SessionPersistence] Error checking dead sessions:', error);
    }

    return dead;
  }

  /**
   * Create a session for a worktree if one doesn't exist
   */
  async ensureSession(
    worktreeId: string,
    projectId: string,
    cwd: string,
    command: string = 'claude --dangerously-skip-permissions'
  ): Promise<PersistedSession> {
    // Check if session already exists and is valid
    const existing = this.sessions.get(worktreeId);
    if (existing) {
      // Verify it's still alive
      if (daemonClient.isConnected()) {
        const daemonSession = await daemonClient.getSession(existing.id);
        if (daemonSession) {
          return existing;
        }
      }
    }

    // Create new session
    const project = projectService.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const sessionId = await daemonClient.createSession(
      worktreeId,
      project.path,
      cwd,
      command
    );

    return await this.registerSession(worktreeId, projectId, sessionId, command, cwd);
  }
}

export const sessionPersistenceService = new SessionPersistenceService();
