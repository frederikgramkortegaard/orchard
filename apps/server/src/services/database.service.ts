import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { EventEmitter } from 'events';

export interface ActivityLog {
  id: number;
  projectId: string;
  timestamp: string;
  type: 'tick' | 'action' | 'event' | 'decision' | 'error' | 'llm_request' | 'llm_response';
  category: 'system' | 'orchestrator' | 'agent' | 'worktree' | 'user';
  summary: string;
  details: string; // JSON string
  correlationId?: string;
}

export type MessageStatus = 'unread' | 'read' | 'working' | 'resolved';

export interface ChatMessage {
  id: string;
  projectId: string;
  timestamp: string;
  from: 'user' | 'orchestrator';
  text: string;
  replyTo?: string;
  processed: boolean;
  status: MessageStatus;
}

export interface AgentMessage {
  id: number;
  projectId: string;
  worktreeId: string;
  timestamp: string;
  direction: 'to_agent' | 'from_agent';
  content: string;
  messageType: 'task' | 'response' | 'question' | 'status' | 'error';
  processed: boolean;
}

export interface OrchestratorState {
  projectId: string;
  key: string;
  value: string;
}

export type SessionStatus = 'active' | 'disconnected' | 'resumed' | 'terminated';

export interface AgentSession {
  id: string;
  worktreeId: string;
  projectId: string;
  command: string;
  cwd: string;
  claudeSessionId?: string;
  status: SessionStatus;
  createdAt: string;
  lastActivityAt: string;
  resumeCount: number;
  metadata?: string; // JSON string for additional state
}

export type PrintSessionStatus = 'running' | 'completed' | 'failed';

export interface PrintSession {
  id: string;
  worktreeId: string;
  projectId: string;
  task: string;
  status: PrintSessionStatus;
  exitCode?: number;
  startedAt: string;
  completedAt?: string;
}

export interface TerminalOutputChunk {
  id: number;
  sessionId: string;
  chunk: string;
  timestamp: string;
}

class DatabaseService extends EventEmitter {
  private databases: Map<string, Database.Database> = new Map();
  private initialized = false;

  /**
   * Get or create a database for a project
   */
  getDatabase(projectPath: string): Database.Database {
    const existing = this.databases.get(projectPath);
    if (existing) return existing;

    const orchardDir = join(projectPath, '.orchard');
    if (!existsSync(orchardDir)) {
      mkdirSync(orchardDir, { recursive: true });
    }

    const dbPath = join(orchardDir, 'orchard.db');
    const db = new Database(dbPath);

    // Enable WAL mode for better concurrent access
    db.pragma('journal_mode = WAL');

    // Initialize schema
    this.initializeSchema(db);

    this.databases.set(projectPath, db);
    console.log(`[DatabaseService] Opened database: ${dbPath}`);

    return db;
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(db: Database.Database): void {
    // Activity logs table
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT DEFAULT '{}',
        correlation_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_activity_logs_project_id ON activity_logs(project_id);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_type ON activity_logs(type);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_category ON activity_logs(category);
    `);

    // Chat messages table (user <-> orchestrator)
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        sender TEXT NOT NULL CHECK (sender IN ('user', 'orchestrator')),
        text TEXT NOT NULL,
        reply_to TEXT,
        processed INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'working', 'resolved')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_project_id ON chat_messages(project_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_processed ON chat_messages(processed);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_status ON chat_messages(status);
    `);

    // Migration: Add status column if it doesn't exist (for existing databases)
    try {
      db.exec(`ALTER TABLE chat_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'working', 'resolved'))`);
      console.log('[DatabaseService] Migrated chat_messages: added status column');
    } catch {
      // Column already exists, ignore
    }

    // Agent messages table (orchestrator <-> coding agents)
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        direction TEXT NOT NULL CHECK (direction IN ('to_agent', 'from_agent')),
        content TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK (message_type IN ('task', 'response', 'question', 'status', 'error')),
        processed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_agent_messages_project_id ON agent_messages(project_id);
      CREATE INDEX IF NOT EXISTS idx_agent_messages_worktree_id ON agent_messages(worktree_id);
      CREATE INDEX IF NOT EXISTS idx_agent_messages_timestamp ON agent_messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_agent_messages_processed ON agent_messages(processed);
    `);

    // Orchestrator state table (key-value store per project)
    db.exec(`
      CREATE TABLE IF NOT EXISTS orchestrator_state (
        project_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (project_id, key)
      );
    `);

    // Agent sessions table (for resume capability)
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        worktree_id TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL,
        command TEXT NOT NULL,
        cwd TEXT NOT NULL,
        claude_session_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected', 'resumed', 'terminated')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
        resume_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_agent_sessions_project_id ON agent_sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_agent_sessions_worktree_id ON agent_sessions(worktree_id);
      CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
    `);

    // Print sessions table (for claude -p streaming to SQLite)
    db.exec(`
      CREATE TABLE IF NOT EXISTS print_sessions (
        id TEXT PRIMARY KEY,
        worktree_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        task TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
        exit_code INTEGER,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_print_sessions_worktree_id ON print_sessions(worktree_id);
      CREATE INDEX IF NOT EXISTS idx_print_sessions_project_id ON print_sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_print_sessions_status ON print_sessions(status);
    `);

    // Terminal output chunks (streamed output from claude -p)
    db.exec(`
      CREATE TABLE IF NOT EXISTS terminal_output (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        chunk TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES print_sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_terminal_output_session_id ON terminal_output(session_id);
    `);

    console.log('[DatabaseService] Schema initialized');
  }

  // ============ Activity Logs ============

  /**
   * Add an activity log entry
   */
  addActivityLog(
    projectPath: string,
    projectId: string,
    entry: {
      type: ActivityLog['type'];
      category: ActivityLog['category'];
      summary: string;
      details?: Record<string, unknown>;
      correlationId?: string;
    }
  ): number {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      INSERT INTO activity_logs (project_id, timestamp, type, category, summary, details, correlation_id)
      VALUES (?, datetime('now'), ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      projectId,
      entry.type,
      entry.category,
      entry.summary,
      JSON.stringify(entry.details || {}),
      entry.correlationId || null
    );

    this.emit('activity', { projectId, ...entry });
    return result.lastInsertRowid as number;
  }

  /**
   * Get recent activity logs
   */
  getActivityLogs(
    projectPath: string,
    projectId: string,
    options: { limit?: number; offset?: number; type?: string; category?: string } = {}
  ): ActivityLog[] {
    const db = this.getDatabase(projectPath);
    const { limit = 100, offset = 0, type, category } = options;

    let query = 'SELECT * FROM activity_logs WHERE project_id = ?';
    const params: (string | number)[] = [projectId];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      timestamp: row.timestamp,
      type: row.type,
      category: row.category,
      summary: row.summary,
      details: row.details,
      correlationId: row.correlation_id,
    }));
  }

  /**
   * Clear activity logs older than a certain age
   */
  clearOldActivityLogs(projectPath: string, projectId: string, olderThanDays: number = 7): number {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      DELETE FROM activity_logs
      WHERE project_id = ? AND timestamp < datetime('now', ?)
    `);
    const result = stmt.run(projectId, `-${olderThanDays} days`);
    return result.changes;
  }

  // ============ Chat Messages ============

  /**
   * Add a chat message
   */
  addChatMessage(
    projectPath: string,
    message: {
      id: string;
      projectId: string;
      from: 'user' | 'orchestrator';
      text: string;
      replyTo?: string;
    }
  ): void {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      INSERT INTO chat_messages (id, project_id, timestamp, sender, text, reply_to, processed)
      VALUES (?, ?, datetime('now'), ?, ?, ?, 0)
    `);

    stmt.run(
      message.id,
      message.projectId,
      message.from,
      message.text,
      message.replyTo || null
    );

    this.emit('chat', { type: 'new', message });
  }

  /**
   * Get chat messages
   */
  getChatMessages(
    projectPath: string,
    projectId: string,
    options: { limit?: number; unprocessedOnly?: boolean; from?: 'user' | 'orchestrator' } = {}
  ): ChatMessage[] {
    const db = this.getDatabase(projectPath);
    const { limit = 50, unprocessedOnly = false, from } = options;

    let query = 'SELECT * FROM chat_messages WHERE project_id = ?';
    const params: (string | number)[] = [projectId];

    if (unprocessedOnly) {
      query += ' AND processed = 0';
    }
    if (from) {
      query += ' AND sender = ?';
      params.push(from);
    }

    query += ' ORDER BY timestamp ASC LIMIT ?';
    params.push(limit);

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      timestamp: row.timestamp,
      from: row.sender,
      text: row.text,
      replyTo: row.reply_to,
      processed: !!row.processed,
      status: (row.status || 'unread') as MessageStatus,
    }));
  }

  /**
   * Get recent chat messages (most recent first, then reversed for display)
   */
  getRecentChatMessages(
    projectPath: string,
    projectId: string,
    limit: number = 50
  ): ChatMessage[] {
    const db = this.getDatabase(projectPath);
    // Use rowid for ordering since timestamp formats may vary (ISO vs SQLite)
    const stmt = db.prepare(`
      SELECT * FROM chat_messages
      WHERE project_id = ?
      ORDER BY rowid DESC
      LIMIT ?
    `);

    const rows = stmt.all(projectId, limit) as any[];

    // Reverse to get chronological order
    return rows.reverse().map(row => ({
      id: row.id,
      projectId: row.project_id,
      timestamp: row.timestamp,
      from: row.sender,
      text: row.text,
      replyTo: row.reply_to,
      processed: !!row.processed,
      status: (row.status || 'unread') as MessageStatus,
    }));
  }

  /**
   * Update the status of a chat message
   */
  updateChatMessageStatus(
    projectPath: string,
    messageId: string,
    status: MessageStatus
  ): boolean {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      UPDATE chat_messages SET status = ?
      WHERE id = ?
    `);
    const result = stmt.run(status, messageId);

    if (result.changes > 0) {
      this.emit('chat', { type: 'status_update', messageId, status });
      return true;
    }
    return false;
  }

  /**
   * Mark chat messages as processed
   */
  markChatMessagesProcessed(projectPath: string, projectId: string, messageIds?: string[]): number {
    const db = this.getDatabase(projectPath);

    if (messageIds && messageIds.length > 0) {
      const placeholders = messageIds.map(() => '?').join(',');
      const stmt = db.prepare(`
        UPDATE chat_messages SET processed = 1
        WHERE project_id = ? AND id IN (${placeholders})
      `);
      const result = stmt.run(projectId, ...messageIds);
      return result.changes;
    } else {
      const stmt = db.prepare(`
        UPDATE chat_messages SET processed = 1
        WHERE project_id = ? AND processed = 0
      `);
      const result = stmt.run(projectId);
      return result.changes;
    }
  }

  /**
   * Get unprocessed user message count
   */
  getUnprocessedUserMessageCount(projectPath: string, projectId: string): number {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM chat_messages
      WHERE project_id = ? AND sender = 'user' AND processed = 0
    `);
    const row = stmt.get(projectId) as { count: number };
    return row.count;
  }

  // ============ Agent Messages ============

  /**
   * Add an agent message
   */
  addAgentMessage(
    projectPath: string,
    message: {
      projectId: string;
      worktreeId: string;
      direction: 'to_agent' | 'from_agent';
      content: string;
      messageType: AgentMessage['messageType'];
    }
  ): number {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      INSERT INTO agent_messages (project_id, worktree_id, timestamp, direction, content, message_type, processed)
      VALUES (?, ?, datetime('now'), ?, ?, ?, 0)
    `);

    const result = stmt.run(
      message.projectId,
      message.worktreeId,
      message.direction,
      message.content,
      message.messageType
    );

    this.emit('agent_message', { type: 'new', message });
    return result.lastInsertRowid as number;
  }

  /**
   * Get agent messages for a worktree
   */
  getAgentMessages(
    projectPath: string,
    worktreeId: string,
    options: { limit?: number; unprocessedOnly?: boolean; direction?: 'to_agent' | 'from_agent' } = {}
  ): AgentMessage[] {
    const db = this.getDatabase(projectPath);
    const { limit = 50, unprocessedOnly = false, direction } = options;

    let query = 'SELECT * FROM agent_messages WHERE worktree_id = ?';
    const params: (string | number)[] = [worktreeId];

    if (unprocessedOnly) {
      query += ' AND processed = 0';
    }
    if (direction) {
      query += ' AND direction = ?';
      params.push(direction);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      worktreeId: row.worktree_id,
      timestamp: row.timestamp,
      direction: row.direction,
      content: row.content,
      messageType: row.message_type,
      processed: !!row.processed,
    }));
  }

  /**
   * Mark agent messages as processed
   */
  markAgentMessagesProcessed(projectPath: string, worktreeId: string, messageIds?: number[]): number {
    const db = this.getDatabase(projectPath);

    if (messageIds && messageIds.length > 0) {
      const placeholders = messageIds.map(() => '?').join(',');
      const stmt = db.prepare(`
        UPDATE agent_messages SET processed = 1
        WHERE worktree_id = ? AND id IN (${placeholders})
      `);
      const result = stmt.run(worktreeId, ...messageIds);
      return result.changes;
    } else {
      const stmt = db.prepare(`
        UPDATE agent_messages SET processed = 1
        WHERE worktree_id = ? AND processed = 0
      `);
      const result = stmt.run(worktreeId);
      return result.changes;
    }
  }

  // ============ Orchestrator State ============

  /**
   * Set an orchestrator state value
   */
  setState(projectPath: string, projectId: string, key: string, value: string): void {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      INSERT INTO orchestrator_state (project_id, key, value, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT (project_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    stmt.run(projectId, key, value);
  }

  /**
   * Get an orchestrator state value
   */
  getState(projectPath: string, projectId: string, key: string): string | null {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      SELECT value FROM orchestrator_state WHERE project_id = ? AND key = ?
    `);
    const row = stmt.get(projectId, key) as { value: string } | undefined;
    return row?.value || null;
  }

  /**
   * Delete an orchestrator state value
   */
  deleteState(projectPath: string, projectId: string, key: string): void {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      DELETE FROM orchestrator_state WHERE project_id = ? AND key = ?
    `);
    stmt.run(projectId, key);
  }

  // ============ Agent Sessions ============

  /**
   * Save or update an agent session
   */
  saveSession(
    projectPath: string,
    session: {
      id: string;
      worktreeId: string;
      projectId: string;
      command: string;
      cwd: string;
      claudeSessionId?: string;
      status?: SessionStatus;
      metadata?: Record<string, unknown>;
    }
  ): AgentSession {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      INSERT INTO agent_sessions (id, worktree_id, project_id, command, cwd, claude_session_id, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (worktree_id) DO UPDATE SET
        id = excluded.id,
        command = excluded.command,
        cwd = excluded.cwd,
        claude_session_id = COALESCE(excluded.claude_session_id, agent_sessions.claude_session_id),
        status = excluded.status,
        last_activity_at = datetime('now'),
        metadata = excluded.metadata
    `);

    stmt.run(
      session.id,
      session.worktreeId,
      session.projectId,
      session.command,
      session.cwd,
      session.claudeSessionId || null,
      session.status || 'active',
      JSON.stringify(session.metadata || {})
    );

    this.emit('session', { type: 'saved', session });
    return this.getSession(projectPath, session.worktreeId)!;
  }

  /**
   * Get a session by worktree ID
   */
  getSession(projectPath: string, worktreeId: string): AgentSession | null {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      SELECT * FROM agent_sessions WHERE worktree_id = ?
    `);
    const row = stmt.get(worktreeId) as any;
    if (!row) return null;

    return {
      id: row.id,
      worktreeId: row.worktree_id,
      projectId: row.project_id,
      command: row.command,
      cwd: row.cwd,
      claudeSessionId: row.claude_session_id,
      status: row.status,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      resumeCount: row.resume_count,
      metadata: row.metadata,
    };
  }

  /**
   * Get all sessions for a project
   */
  getSessionsForProject(projectPath: string, projectId: string): AgentSession[] {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      SELECT * FROM agent_sessions WHERE project_id = ? ORDER BY last_activity_at DESC
    `);
    const rows = stmt.all(projectId) as any[];

    return rows.map(row => ({
      id: row.id,
      worktreeId: row.worktree_id,
      projectId: row.project_id,
      command: row.command,
      cwd: row.cwd,
      claudeSessionId: row.claude_session_id,
      status: row.status,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      resumeCount: row.resume_count,
      metadata: row.metadata,
    }));
  }

  /**
   * Get all active/disconnected sessions for a project (for resume)
   */
  getResumableSessions(projectPath: string, projectId: string): AgentSession[] {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      SELECT * FROM agent_sessions
      WHERE project_id = ? AND status IN ('active', 'disconnected')
      ORDER BY last_activity_at DESC
    `);
    const rows = stmt.all(projectId) as any[];

    return rows.map(row => ({
      id: row.id,
      worktreeId: row.worktree_id,
      projectId: row.project_id,
      command: row.command,
      cwd: row.cwd,
      claudeSessionId: row.claude_session_id,
      status: row.status,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      resumeCount: row.resume_count,
      metadata: row.metadata,
    }));
  }

  /**
   * Update session status
   */
  updateSessionStatus(projectPath: string, worktreeId: string, status: SessionStatus): boolean {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      UPDATE agent_sessions SET status = ?, last_activity_at = datetime('now')
      WHERE worktree_id = ?
    `);
    const result = stmt.run(status, worktreeId);

    if (result.changes > 0) {
      this.emit('session', { type: 'status_update', worktreeId, status });
      return true;
    }
    return false;
  }

  /**
   * Update Claude session ID (for resume capability)
   */
  updateClaudeSessionId(projectPath: string, worktreeId: string, claudeSessionId: string): boolean {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      UPDATE agent_sessions SET claude_session_id = ?, last_activity_at = datetime('now')
      WHERE worktree_id = ?
    `);
    const result = stmt.run(claudeSessionId, worktreeId);

    if (result.changes > 0) {
      this.emit('session', { type: 'claude_session_update', worktreeId, claudeSessionId });
      return true;
    }
    return false;
  }

  /**
   * Update last activity timestamp
   */
  touchSession(projectPath: string, worktreeId: string): boolean {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      UPDATE agent_sessions SET last_activity_at = datetime('now')
      WHERE worktree_id = ?
    `);
    const result = stmt.run(worktreeId);
    return result.changes > 0;
  }

  /**
   * Increment resume count and mark as resumed
   */
  markSessionResumed(projectPath: string, worktreeId: string, newSessionId: string): boolean {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      UPDATE agent_sessions SET
        id = ?,
        status = 'resumed',
        resume_count = resume_count + 1,
        last_activity_at = datetime('now')
      WHERE worktree_id = ?
    `);
    const result = stmt.run(newSessionId, worktreeId);

    if (result.changes > 0) {
      this.emit('session', { type: 'resumed', worktreeId, newSessionId });
      return true;
    }
    return false;
  }

  /**
   * Delete a session
   */
  deleteSession(projectPath: string, worktreeId: string): boolean {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      DELETE FROM agent_sessions WHERE worktree_id = ?
    `);
    const result = stmt.run(worktreeId);

    if (result.changes > 0) {
      this.emit('session', { type: 'deleted', worktreeId });
      return true;
    }
    return false;
  }

  /**
   * Mark all active sessions as disconnected (on daemon disconnect)
   */
  markAllSessionsDisconnected(projectPath: string, projectId: string): number {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      UPDATE agent_sessions SET status = 'disconnected', last_activity_at = datetime('now')
      WHERE project_id = ? AND status = 'active'
    `);
    const result = stmt.run(projectId);
    return result.changes;
  }

  /**
   * Clean up old terminated sessions
   */
  cleanupOldSessions(projectPath: string, projectId: string, olderThanDays: number = 7): number {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      DELETE FROM agent_sessions
      WHERE project_id = ? AND status = 'terminated' AND last_activity_at < datetime('now', ?)
    `);
    const result = stmt.run(projectId, `-${olderThanDays} days`);
    return result.changes;
  }

  // ============ Migration ============

  /**
   * Migrate existing file-based data to SQLite
   */
  async migrateFromFiles(projectPath: string, projectId: string): Promise<{
    chatMessages: number;
    activityLogs: number;
  }> {
    const { readFileSync, existsSync } = await import('fs');
    const stats = { chatMessages: 0, activityLogs: 0 };

    // Migrate chat.json
    const chatPath = join(projectPath, '.orchard', 'chat.json');
    if (existsSync(chatPath)) {
      try {
        const data = JSON.parse(readFileSync(chatPath, 'utf-8'));
        const db = this.getDatabase(projectPath);

        const stmt = db.prepare(`
          INSERT OR IGNORE INTO chat_messages (id, project_id, timestamp, sender, text, reply_to, processed)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `);

        for (const msg of data) {
          stmt.run(
            msg.id,
            msg.projectId || projectId,
            msg.timestamp,
            msg.from,
            msg.text,
            msg.replyTo || null
          );
          stats.chatMessages++;
        }

        console.log(`[DatabaseService] Migrated ${stats.chatMessages} chat messages`);
      } catch (error) {
        console.error('[DatabaseService] Failed to migrate chat.json:', error);
      }
    }

    // Migrate activity-log.jsonl
    const activityPath = join(projectPath, '.orchard', 'activity-log.jsonl');
    if (existsSync(activityPath)) {
      try {
        const lines = readFileSync(activityPath, 'utf-8').trim().split('\n').filter(Boolean);
        const db = this.getDatabase(projectPath);

        const stmt = db.prepare(`
          INSERT INTO activity_logs (project_id, timestamp, type, category, summary, details, correlation_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            stmt.run(
              projectId,
              entry.timestamp,
              entry.type || 'event',
              entry.category || 'system',
              entry.summary || '',
              JSON.stringify(entry.details || {}),
              entry.correlationId || null
            );
            stats.activityLogs++;
          } catch {
            // Skip invalid lines
          }
        }

        console.log(`[DatabaseService] Migrated ${stats.activityLogs} activity logs`);
      } catch (error) {
        console.error('[DatabaseService] Failed to migrate activity-log.jsonl:', error);
      }
    }

    return stats;
  }

  // ============ Print Sessions (claude -p streaming) ============

  /**
   * Create a new print session
   */
  createPrintSession(
    projectPath: string,
    session: { id: string; worktreeId: string; projectId: string; task: string }
  ): void {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      INSERT INTO print_sessions (id, worktree_id, project_id, task, status, started_at)
      VALUES (?, ?, ?, ?, 'running', datetime('now'))
    `);
    stmt.run(session.id, session.worktreeId, session.projectId, session.task);
    this.emit('print_session', { type: 'created', session });
  }

  /**
   * Get a print session by ID
   */
  getPrintSession(projectPath: string, sessionId: string): PrintSession | null {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      SELECT id, worktree_id as worktreeId, project_id as projectId, task, status,
             exit_code as exitCode, started_at as startedAt, completed_at as completedAt
      FROM print_sessions WHERE id = ?
    `);
    return stmt.get(sessionId) as PrintSession | null;
  }

  /**
   * Get print sessions for a worktree
   */
  getPrintSessionsForWorktree(projectPath: string, worktreeId: string): PrintSession[] {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      SELECT id, worktree_id as worktreeId, project_id as projectId, task, status,
             exit_code as exitCode, started_at as startedAt, completed_at as completedAt
      FROM print_sessions WHERE worktree_id = ? ORDER BY started_at DESC
    `);
    return stmt.all(worktreeId) as PrintSession[];
  }

  /**
   * Complete a print session
   */
  completePrintSession(projectPath: string, sessionId: string, exitCode: number): void {
    const db = this.getDatabase(projectPath);
    const status = exitCode === 0 ? 'completed' : 'failed';
    const stmt = db.prepare(`
      UPDATE print_sessions SET status = ?, exit_code = ?, completed_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(status, exitCode, sessionId);
    this.emit('print_session', { type: 'completed', sessionId, status, exitCode });
  }

  /**
   * Append output to a print session
   */
  appendTerminalOutput(projectPath: string, sessionId: string, chunk: string): number {
    const db = this.getDatabase(projectPath);
    const stmt = db.prepare(`
      INSERT INTO terminal_output (session_id, chunk, timestamp)
      VALUES (?, ?, datetime('now'))
    `);
    const result = stmt.run(sessionId, chunk);
    this.emit('terminal_output', { sessionId, chunk, id: result.lastInsertRowid });
    return result.lastInsertRowid as number;
  }

  /**
   * Get terminal output for a session (optionally after a certain ID for polling)
   */
  getTerminalOutput(projectPath: string, sessionId: string, afterId?: number): TerminalOutputChunk[] {
    const db = this.getDatabase(projectPath);
    if (afterId !== undefined) {
      const stmt = db.prepare(`
        SELECT id, session_id as sessionId, chunk, timestamp
        FROM terminal_output WHERE session_id = ? AND id > ? ORDER BY id ASC
      `);
      return stmt.all(sessionId, afterId) as TerminalOutputChunk[];
    } else {
      const stmt = db.prepare(`
        SELECT id, session_id as sessionId, chunk, timestamp
        FROM terminal_output WHERE session_id = ? ORDER BY id ASC
      `);
      return stmt.all(sessionId) as TerminalOutputChunk[];
    }
  }

  /**
   * Get full terminal output as a single string
   */
  getFullTerminalOutput(projectPath: string, sessionId: string): string {
    const chunks = this.getTerminalOutput(projectPath, sessionId);
    return chunks.map(c => c.chunk).join('');
  }

  /**
   * Close all database connections
   */
  close(): void {
    for (const [path, db] of this.databases) {
      db.close();
      console.log(`[DatabaseService] Closed database: ${path}`);
    }
    this.databases.clear();
  }
}

export const databaseService = new DatabaseService();
