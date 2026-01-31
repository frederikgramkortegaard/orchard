import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DAEMON_PORT = 3002;

interface SessionInfo {
  id: string;
  worktreeId: string;
  projectPath: string;
  cwd: string;
  createdAt: string;
  initialCommand?: string;
}

interface PtySession {
  id: string;
  worktreeId: string;
  projectPath: string;
  cwd: string;
  createdAt: Date;
  pty: pty.IPty;
  scrollback: string[];
  subscribers: Set<WebSocket>;
  unackedData: number;
  messageBuffer: string;
}

// Structured output message types for agent communication
interface OrchestratorMessage {
  type: 'TASK_COMPLETE' | 'QUESTION' | 'BLOCKED' | 'STATUS_UPDATE' | 'ERROR' | 'REQUEST_REVIEW';
  data: Record<string, unknown>;
}

class TerminalDaemon {
  private sessions = new Map<string, PtySession>();
  private wss: WebSocketServer;

  // Regex to match orchestrator-message code blocks
  // Handles both ```orchestrator-message and ``` closings with various whitespace
  private readonly orchestratorMessageRegex = /```orchestrator-message\s*\n([\s\S]*?)```/g;

  /**
   * Parse orchestrator-message blocks from terminal output
   * Returns parsed messages and remaining unparsed buffer
   */
  private parseOrchestratorMessages(buffer: string): { messages: OrchestratorMessage[]; remaining: string } {
    const messages: OrchestratorMessage[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Reset regex state
    this.orchestratorMessageRegex.lastIndex = 0;

    while ((match = this.orchestratorMessageRegex.exec(buffer)) !== null) {
      try {
        const jsonContent = match[1].trim();
        const parsed = JSON.parse(jsonContent) as OrchestratorMessage;

        // Validate message structure
        if (parsed.type && typeof parsed.type === 'string') {
          messages.push(parsed);
        }
      } catch (err) {
        // Invalid JSON, skip this block
        console.warn('Failed to parse orchestrator message:', err);
      }
      lastIndex = match.index + match[0].length;
    }

    // Check if there's an incomplete block at the end (started but not closed)
    const incompleteStart = buffer.lastIndexOf('```orchestrator-message');
    if (incompleteStart > lastIndex) {
      // Keep the incomplete block in buffer for next chunk
      return { messages, remaining: buffer.slice(incompleteStart) };
    }

    return { messages, remaining: '' };
  }

  /**
   * Broadcast a structured orchestrator message to all clients
   */
  private broadcastOrchestratorMessage(session: PtySession, message: OrchestratorMessage) {
    const notification = JSON.stringify({
      type: 'agent:message',
      sessionId: session.id,
      worktreeId: session.worktreeId,
      messageType: message.type,
      data: message.data,
      timestamp: Date.now(),
    });

    // Broadcast to session subscribers
    session.subscribers.forEach((sub) => {
      if (sub.readyState === WebSocket.OPEN) {
        sub.send(notification);
      }
    });

    // Broadcast to all connected clients
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(notification);
      }
    });

    console.log(`Orchestrator message [${message.type}] from session ${session.id} (worktree: ${session.worktreeId})`);
  }

  constructor() {
    // Load persisted session info (but we can't restore PTY processes)
    this.loadPersistedSessions();

    // Create WebSocket server
    this.wss = new WebSocketServer({ port: DAEMON_PORT });
    console.log(`Terminal daemon listening on ws://localhost:${DAEMON_PORT}`);

    this.wss.on('connection', (ws) => {
      console.log('Client connected to terminal daemon');

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(ws, msg);
        } catch (err) {
          console.error('Error handling message:', err);
        }
      });

      ws.on('close', () => {
        // Unsubscribe from all sessions
        this.sessions.forEach((session) => {
          session.subscribers.delete(ws);
        });
      });

      // Send connected acknowledgment
      ws.send(JSON.stringify({ type: 'daemon:connected', timestamp: Date.now() }));
    });

    // Graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  private handleMessage(ws: WebSocket, msg: any) {
    switch (msg.type) {
      case 'session:create':
        this.createSession(ws, msg);
        break;
      case 'session:destroy':
        this.destroySession(ws, msg.sessionId, msg.requestId);
        break;
      case 'session:list':
        this.listSessions(ws, msg.requestId);
        break;
      case 'session:get':
        this.getSession(ws, msg.sessionId, msg.requestId);
        break;
      case 'terminal:subscribe':
        this.subscribeToSession(ws, msg.sessionId);
        break;
      case 'terminal:unsubscribe':
        this.unsubscribeFromSession(ws, msg.sessionId);
        break;
      case 'terminal:input':
        this.writeToSession(msg.sessionId, msg.data);
        break;
      case 'terminal:resize':
        this.resizeSession(msg.sessionId, msg.cols, msg.rows);
        break;
      case 'terminal:ack':
        this.acknowledgeData(msg.sessionId, msg.count);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
      default:
        console.warn('Unknown message type:', msg.type);
    }
  }

  private createSession(ws: WebSocket, msg: any) {
    const { worktreeId, projectPath, cwd, initialCommand, requestId } = msg;
    const id = crypto.randomUUID();

    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    const session: PtySession = {
      id,
      worktreeId,
      projectPath,
      cwd,
      createdAt: new Date(),
      pty: ptyProcess,
      scrollback: [],
      subscribers: new Set(),
      unackedData: 0,
      messageBuffer: '',
    };

    // Track if we need to auto-accept trust prompt for Claude sessions
    let trustPromptHandled = false;
    const isClaudeSession = initialCommand?.includes('claude');
    let taskCompleteNotified = false;
    let isRateLimited = false;

    // Handle PTY output
    ptyProcess.onData((data) => {
      // Add to scrollback (keep last 10000 lines worth)
      session.scrollback.push(data);
      if (session.scrollback.length > 10000) {
        session.scrollback.shift();
      }

      // Auto-accept Claude's prompts if this is a Claude session
      if (isClaudeSession && !trustPromptHandled) {
        const recentOutput = session.scrollback.slice(-10).join('');
        // Handle trust folder prompt
        if (recentOutput.includes('Do you trust the files in this folder?') ||
            recentOutput.includes('Yes, proceed')) {
          trustPromptHandled = true;
          setTimeout(() => {
            ptyProcess.write('\r');
            console.log(`Auto-accepted trust prompt for session ${id}`);
          }, 100);
        }
        // Handle bypass permissions confirmation (select option 2: "Yes, I accept")
        // Only trigger when we see "Enter to confirm" which means the menu is ready
        if ((recentOutput.includes('Bypass Permissions mode') || recentOutput.includes('Yes, I accept'))
            && recentOutput.includes('Enter to confirm')) {
          trustPromptHandled = true;
          // Send arrow down to select option 2, then enter
          setTimeout(() => {
            ptyProcess.write('\x1b[B'); // Arrow down
            setTimeout(() => {
              ptyProcess.write('\r'); // Enter
              console.log(`Auto-accepted bypass permissions for session ${id}`);
            }, 200);
          }, 500);
        }
      }

      // Parse structured orchestrator-message blocks from output
      if (isClaudeSession) {
        session.messageBuffer += data;

        // Parse any complete orchestrator-message blocks
        const { messages, remaining } = this.parseOrchestratorMessages(session.messageBuffer);
        session.messageBuffer = remaining;

        // Broadcast each parsed message
        for (const message of messages) {
          this.broadcastOrchestratorMessage(session, message);

          // Handle TASK_COMPLETE specially to maintain backwards compatibility
          if (message.type === 'TASK_COMPLETE' && !taskCompleteNotified) {
            taskCompleteNotified = true;
            const notification = JSON.stringify({
              type: 'agent:task-complete',
              sessionId: id,
              worktreeId,
              timestamp: Date.now(),
            });
            session.subscribers.forEach((sub) => {
              if (sub.readyState === WebSocket.OPEN) {
                sub.send(notification);
              }
            });
            this.wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(notification);
              }
            });
          }
        }

        // Limit message buffer size to prevent memory issues
        if (session.messageBuffer.length > 50000) {
          session.messageBuffer = session.messageBuffer.slice(-10000);
        }
      }

      // Detect legacy "TASK COMPLETE" text marker for backwards compatibility
      if (isClaudeSession && !taskCompleteNotified) {
        const recentOutput = session.scrollback.slice(-20).join('');
        if (recentOutput.includes(':ORCHESTRATOR: TASK COMPLETE') || recentOutput.includes('TASK COMPLETE')) {
          taskCompleteNotified = true;
          const notification = JSON.stringify({
            type: 'agent:task-complete',
            sessionId: id,
            worktreeId,
            timestamp: Date.now(),
          });
          // Broadcast to all subscribers
          session.subscribers.forEach((sub) => {
            if (sub.readyState === WebSocket.OPEN) {
              sub.send(notification);
            }
          });
          // Also broadcast to all connected clients
          this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(notification);
            }
          });
          console.log(`Task complete detected for session ${id} (worktree: ${worktreeId})`);
        }
      }

      // Detect Claude session/rate limits and broadcast notification
      if (isClaudeSession) {
        const recentOutput = session.scrollback.slice(-30).join('');

        // Patterns that indicate rate limiting (Claude Code specific messages)
        const rateLimitPatterns = [
          /session limit/i,
          /rate limit/i,
          /too many requests/i,
          /usage limit.*reached/i,
          /you.ve hit.*limit/i,
          /waiting.*cooldown/i,
          /temporarily unavailable/i,
          /try again in \d+/i,
          /max.*tokens.*exceeded/i,
          /concurrent.*session/i,
          /please wait/i,
        ];

        const isNowRateLimited = rateLimitPatterns.some(pattern => pattern.test(recentOutput));

        if (isNowRateLimited && !isRateLimited) {
          // Just became rate limited
          isRateLimited = true;

          // Extract the rate limit message for display
          const lines = recentOutput.split(/[\r\n]+/).filter(l => l.trim());
          const limitMessage = lines.slice(-5).join(' ').substring(0, 200);

          const notification = JSON.stringify({
            type: 'agent:rate-limited',
            rateLimit: {
              sessionId: id,
              worktreeId,
              isLimited: true,
              message: limitMessage,
              detectedAt: Date.now(),
            },
          });

          // Broadcast to all connected clients
          this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(notification);
            }
          });
          console.log(`Rate limit detected for session ${id} (worktree: ${worktreeId})`);
        } else if (!isNowRateLimited && isRateLimited) {
          // Rate limit cleared - Claude is working again
          isRateLimited = false;

          const notification = JSON.stringify({
            type: 'agent:rate-limit-cleared',
            sessionId: id,
            worktreeId,
            timestamp: Date.now(),
          });

          // Broadcast to all connected clients
          this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(notification);
            }
          });
          console.log(`Rate limit cleared for session ${id} (worktree: ${worktreeId})`);
        }
      }

      // Broadcast to subscribers with flow control
      const MAX_UNACKED = 100;
      if (session.unackedData < MAX_UNACKED) {
        session.unackedData++;
        const message = JSON.stringify({
          type: 'terminal:data',
          sessionId: id,
          data,
        });
        session.subscribers.forEach((sub) => {
          if (sub.readyState === WebSocket.OPEN) {
            sub.send(message);
          }
        });
      }
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      const message = JSON.stringify({
        type: 'terminal:exit',
        sessionId: id,
        exitCode,
      });
      session.subscribers.forEach((sub) => {
        if (sub.readyState === WebSocket.OPEN) {
          sub.send(message);
        }
      });
    });

    this.sessions.set(id, session);
    this.persistSessions();

    // Send initial command if provided
    if (initialCommand) {
      setTimeout(() => {
        ptyProcess.write(initialCommand + '\r');
      }, 500);
    }

    ws.send(JSON.stringify({
      type: 'session:created',
      requestId,
      session: {
        id,
        worktreeId,
        projectPath,
        cwd,
        createdAt: session.createdAt.toISOString(),
      },
    }));

    console.log(`Created session ${id} for worktree ${worktreeId} in project ${projectPath}`);
  }

  private destroySession(ws: WebSocket, sessionId: string, requestId?: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      ws.send(JSON.stringify({ type: 'session:error', requestId, error: 'Session not found' }));
      return;
    }

    session.pty.kill();
    this.sessions.delete(sessionId);
    this.persistSessions();

    ws.send(JSON.stringify({ type: 'session:destroyed', requestId, sessionId }));
    console.log(`Destroyed session ${sessionId}`);
  }

  private listSessions(ws: WebSocket, requestId?: string) {
    const sessions = Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      worktreeId: s.worktreeId,
      projectPath: s.projectPath,
      cwd: s.cwd,
      createdAt: s.createdAt.toISOString(),
      subscriberCount: s.subscribers.size,
    }));
    ws.send(JSON.stringify({ type: 'session:list', requestId, sessions }));
  }

  private getSession(ws: WebSocket, sessionId: string, requestId?: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      ws.send(JSON.stringify({ type: 'session:error', requestId, error: 'Session not found', sessionId }));
      return;
    }
    ws.send(JSON.stringify({
      type: 'session:info',
      requestId,
      session: {
        id: session.id,
        worktreeId: session.worktreeId,
        projectPath: session.projectPath,
        cwd: session.cwd,
        createdAt: session.createdAt.toISOString(),
        subscriberCount: session.subscribers.size,
      },
    }));
  }

  private subscribeToSession(ws: WebSocket, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      ws.send(JSON.stringify({ type: 'terminal:error', error: 'Session not found', sessionId }));
      return;
    }

    session.subscribers.add(ws);

    // Send scrollback
    ws.send(JSON.stringify({
      type: 'terminal:scrollback',
      sessionId,
      data: session.scrollback,
    }));
  }

  private unsubscribeFromSession(ws: WebSocket, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.subscribers.delete(ws);
    }
  }

  private writeToSession(sessionId: string, data: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pty.write(data);
    }
  }

  private resizeSession(sessionId: string, cols: number, rows: number) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pty.resize(cols, rows);
    }
  }

  private acknowledgeData(sessionId: string, count: number) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.unackedData = Math.max(0, session.unackedData - count);
    }
  }

  private getSessionsFilePath(projectPath: string): string {
    const orchardDir = join(projectPath, '.orchard');
    if (!existsSync(orchardDir)) {
      mkdirSync(orchardDir, { recursive: true });
    }
    return join(orchardDir, 'terminal-sessions.json');
  }

  private persistSessions() {
    // Group sessions by projectPath and persist to each project's .orchard folder
    const sessionsByProject = new Map<string, SessionInfo[]>();

    for (const session of this.sessions.values()) {
      const projectPath = session.projectPath;
      if (!sessionsByProject.has(projectPath)) {
        sessionsByProject.set(projectPath, []);
      }
      sessionsByProject.get(projectPath)!.push({
        id: session.id,
        worktreeId: session.worktreeId,
        projectPath: session.projectPath,
        cwd: session.cwd,
        createdAt: session.createdAt.toISOString(),
      });
    }

    // Write to each project's session file
    for (const [projectPath, sessions] of sessionsByProject) {
      try {
        const sessionsFile = this.getSessionsFilePath(projectPath);
        writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2));
      } catch (err) {
        console.error(`Error persisting sessions for project ${projectPath}:`, err);
      }
    }

    // Track which projects have active sessions for cleanup
    this.activeProjectPaths = new Set(sessionsByProject.keys());
  }

  private activeProjectPaths = new Set<string>();

  private loadPersistedSessions() {
    // With project-local session files, we can't enumerate all projects at daemon startup
    // Sessions will be discovered when projects are loaded by the server
    console.log('Terminal daemon started (sessions are stored per-project in .orchard/)');
  }

  clearProjectSessions(projectPath: string) {
    // Clear sessions file for a specific project
    try {
      const sessionsFile = this.getSessionsFilePath(projectPath);
      if (existsSync(sessionsFile)) {
        writeFileSync(sessionsFile, '[]');
      }
    } catch {
      // Ignore errors
    }
  }

  private shutdown() {
    console.log('\nShutting down terminal daemon...');

    // Kill all PTY processes and collect project paths
    const projectPaths = new Set<string>();
    this.sessions.forEach((session) => {
      projectPaths.add(session.projectPath);
      try {
        session.pty.kill();
      } catch {
        // Ignore errors
      }
    });

    // Clear persisted sessions for all active projects
    for (const projectPath of projectPaths) {
      this.clearProjectSessions(projectPath);
    }

    this.wss.close(() => {
      console.log('Terminal daemon stopped');
      process.exit(0);
    });
  }
}

// Start daemon
new TerminalDaemon();
