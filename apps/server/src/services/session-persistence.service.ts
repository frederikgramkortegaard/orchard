import { projectService } from './project.service.js';
import { databaseService, type AgentSession, type SessionStatus } from './database.service.js';
import { daemonClient, type DaemonSession } from '../pty/daemon-client.js';

export interface PersistedSession {
  id: string;
  worktreeId: string;
  projectId: string;
  createdAt: string;
  command: string;
  cwd: string;
  claudeSessionId?: string;
  status: SessionStatus;
  resumeCount: number;
}

/**
 * Session Persistence Service
 *
 * Responsibilities:
 * - Save active session state to SQLite for resume capability
 * - Restore sessions on server restart
 * - Enforce 1 terminal per worktree (no duplicates)
 * - Track Claude session IDs for conversation resumption
 */
class SessionPersistenceService {
  private sessions = new Map<string, PersistedSession>();
  private initialized = false;

  /**
   * Initialize the service - load persisted sessions from SQLite
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const projects = projectService.getAllProjects();
    for (const project of projects) {
      await this.loadSessionsForProject(project.id, project.path);
    }

    // Listen for daemon disconnects to handle session cleanup
    daemonClient.on('disconnected', () => {
      console.log('[SessionPersistence] Daemon disconnected - marking sessions as disconnected');
      this.handleDaemonDisconnect();
    });

    daemonClient.on('connected', async () => {
      console.log('[SessionPersistence] Daemon reconnected - validating sessions');
      await this.validateAllSessions();
    });

    this.initialized = true;
    console.log('[SessionPersistence] Initialized with', this.sessions.size, 'sessions');
  }

  /**
   * Handle daemon disconnect - mark all sessions as disconnected
   */
  private handleDaemonDisconnect(): void {
    const projects = projectService.getAllProjects();
    for (const project of projects) {
      const count = databaseService.markAllSessionsDisconnected(project.path, project.id);
      if (count > 0) {
        console.log(`[SessionPersistence] Marked ${count} sessions as disconnected for project ${project.id}`);
      }
    }

    // Update in-memory cache
    for (const [worktreeId, session] of this.sessions) {
      if (session.status === 'active') {
        session.status = 'disconnected';
      }
    }
  }

  /**
   * Load sessions from SQLite for a specific project
   */
  private async loadSessionsForProject(projectId: string, projectPath: string): Promise<void> {
    try {
      const dbSessions = databaseService.getSessionsForProject(projectPath, projectId);

      for (const dbSession of dbSessions) {
        const session: PersistedSession = {
          id: dbSession.id,
          worktreeId: dbSession.worktreeId,
          projectId: dbSession.projectId,
          createdAt: dbSession.createdAt,
          command: dbSession.command,
          cwd: dbSession.cwd,
          claudeSessionId: dbSession.claudeSessionId,
          status: dbSession.status,
          resumeCount: dbSession.resumeCount,
        };
        // Use worktreeId as key to enforce uniqueness
        this.sessions.set(session.worktreeId, session);
      }

      console.log(`[SessionPersistence] Loaded ${dbSessions.length} sessions for project ${projectId}`);
    } catch (error) {
      console.error(`[SessionPersistence] Error loading sessions for ${projectId}:`, error);
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

    const project = projectService.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Save to SQLite
    const dbSession = databaseService.saveSession(project.path, {
      id: sessionId,
      worktreeId,
      projectId,
      command,
      cwd,
      status: 'active',
    });

    const session: PersistedSession = {
      id: dbSession.id,
      worktreeId: dbSession.worktreeId,
      projectId: dbSession.projectId,
      createdAt: dbSession.createdAt,
      command: dbSession.command,
      cwd: dbSession.cwd,
      claudeSessionId: dbSession.claudeSessionId,
      status: dbSession.status,
      resumeCount: dbSession.resumeCount,
    };

    this.sessions.set(worktreeId, session);

    console.log(`[SessionPersistence] Registered session ${sessionId} for worktree ${worktreeId}`);
    return session;
  }

  /**
   * Remove a session
   */
  async unregisterSession(worktreeId: string): Promise<boolean> {
    const session = this.sessions.get(worktreeId);
    if (!session) return false;

    const project = projectService.getProject(session.projectId);
    if (project) {
      databaseService.updateSessionStatus(project.path, worktreeId, 'terminated');
    }

    this.sessions.delete(worktreeId);

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
   * Update Claude session ID for resume capability
   */
  updateClaudeSessionId(worktreeId: string, claudeSessionId: string): boolean {
    const session = this.sessions.get(worktreeId);
    if (!session) return false;

    const project = projectService.getProject(session.projectId);
    if (!project) return false;

    const updated = databaseService.updateClaudeSessionId(project.path, worktreeId, claudeSessionId);
    if (updated) {
      session.claudeSessionId = claudeSessionId;
      console.log(`[SessionPersistence] Updated Claude session ID for worktree ${worktreeId}: ${claudeSessionId}`);
    }
    return updated;
  }

  /**
   * Touch session to update last activity timestamp
   */
  touchSession(worktreeId: string): boolean {
    const session = this.sessions.get(worktreeId);
    if (!session) return false;

    const project = projectService.getProject(session.projectId);
    if (!project) return false;

    return databaseService.touchSession(project.path, worktreeId);
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
        const project = projectService.getProject(session.projectId);

        if (daemonSessionIds.has(session.id)) {
          result.valid.push(worktreeId);
          // Mark as active if it was disconnected
          if (session.status === 'disconnected' && project) {
            databaseService.updateSessionStatus(project.path, worktreeId, 'active');
            session.status = 'active';
          }
        } else {
          // Session no longer exists in daemon
          result.dead.push(worktreeId);
          if (project) {
            databaseService.updateSessionStatus(project.path, worktreeId, 'disconnected');
            session.status = 'disconnected';
          }
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
   * Get resumable sessions (active or disconnected with Claude session ID)
   */
  getResumableSessions(projectId: string): PersistedSession[] {
    const project = projectService.getProject(projectId);
    if (!project) return [];

    const dbSessions = databaseService.getResumableSessions(project.path, projectId);
    return dbSessions.map(dbSession => ({
      id: dbSession.id,
      worktreeId: dbSession.worktreeId,
      projectId: dbSession.projectId,
      createdAt: dbSession.createdAt,
      command: dbSession.command,
      cwd: dbSession.cwd,
      claudeSessionId: dbSession.claudeSessionId,
      status: dbSession.status,
      resumeCount: dbSession.resumeCount,
    }));
  }

  /**
   * Restore a dead session - creates a new session for the worktree
   * If Claude session ID is available, uses --resume flag
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
      // Build command - use --resume if we have a Claude session ID
      let command = oldSession.command;
      if (oldSession.claudeSessionId && !command.includes('--resume')) {
        // Add resume flag with the Claude session ID
        command = `${command} --resume ${oldSession.claudeSessionId}`;
      }

      // Create new session with same config (or resume command)
      const newSessionId = await daemonClient.createSession(
        worktreeId,
        project.path,
        oldSession.cwd,
        command
      );

      // Update in SQLite
      databaseService.markSessionResumed(project.path, worktreeId, newSessionId);

      // Update in-memory cache
      const newSession: PersistedSession = {
        ...oldSession,
        id: newSessionId,
        status: 'resumed',
        resumeCount: oldSession.resumeCount + 1,
      };

      this.sessions.set(worktreeId, newSession);

      console.log(`[SessionPersistence] Restored session for ${worktreeId}: ${newSessionId} (resume count: ${newSession.resumeCount})`);
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
      // Return disconnected sessions from cache
      return Array.from(this.sessions.values())
        .filter(s => s.status === 'disconnected');
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

  /**
   * Clean up old terminated sessions
   */
  cleanupOldSessions(projectId: string, olderThanDays: number = 7): number {
    const project = projectService.getProject(projectId);
    if (!project) return 0;

    return databaseService.cleanupOldSessions(project.path, projectId, olderThanDays);
  }
}

export const sessionPersistenceService = new SessionPersistenceService();
