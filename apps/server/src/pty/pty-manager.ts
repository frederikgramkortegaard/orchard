import * as pty from 'node-pty';
import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';

export interface PtySession {
  id: string;
  worktreeId: string;
  ptyProcess: pty.IPty;
  cwd: string;
  subscribers: Set<WebSocket>;
  scrollbackBuffer: string[];
  createdAt: Date;
  sequenceNumber: number;
  unackedChunks: number;
}

class PtyManager {
  private sessions = new Map<string, PtySession>();
  private maxScrollback = 10000;
  private maxSessions = 20;

  createSession(worktreeId: string, cwd: string, initialCommand?: string): string {
    this.pruneIfNeeded();

    const sessionId = randomUUID();
    const shell = process.env.SHELL || '/bin/zsh';

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    const session: PtySession = {
      id: sessionId,
      worktreeId,
      ptyProcess,
      cwd,
      subscribers: new Set(),
      scrollbackBuffer: [],
      createdAt: new Date(),
      sequenceNumber: 0,
      unackedChunks: 0,
    };

    ptyProcess.onData((data) => {
      this.appendToScrollback(session, data);
      session.sequenceNumber++;
      session.unackedChunks++;

      session.subscribers.forEach((ws) => {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(JSON.stringify({
            type: 'terminal:data',
            sessionId,
            data,
            seq: session.sequenceNumber,
          }));
        }
      });

      // Flow control: pause if too many unacked
      if (session.unackedChunks > 100) {
        ptyProcess.pause();
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      session.subscribers.forEach((ws) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'terminal:exit',
            sessionId,
            exitCode,
          }));
        }
      });
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, session);

    if (initialCommand) {
      setTimeout(() => {
        ptyProcess.write(initialCommand + '\r');
      }, 100);
    }

    return sessionId;
  }

  destroySession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.ptyProcess.kill();
    session.subscribers.forEach((ws) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'terminal:exit',
          sessionId,
          exitCode: -1,
        }));
      }
    });
    this.sessions.delete(sessionId);
    return true;
  }

  writeToSession(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.ptyProcess.write(data);
    return true;
  }

  resizeSession(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.ptyProcess.resize(cols, rows);
    return true;
  }

  subscribeToSession(sessionId: string, ws: WebSocket): string[] | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.subscribers.add(ws);
    return session.scrollbackBuffer;
  }

  unsubscribeFromSession(sessionId: string, ws: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.subscribers.delete(ws);
    }
  }

  acknowledgeData(sessionId: string, count: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.unackedChunks = Math.max(0, session.unackedChunks - count);

    // Resume if below threshold
    if (session.unackedChunks < 50) {
      session.ptyProcess.resume();
    }
  }

  getSession(sessionId: string): PtySession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionsForWorktree(worktreeId: string): PtySession[] {
    return Array.from(this.sessions.values()).filter(s => s.worktreeId === worktreeId);
  }

  getAllSessions(): PtySession[] {
    return Array.from(this.sessions.values());
  }

  private pruneIfNeeded(): void {
    if (this.sessions.size >= this.maxSessions) {
      const oldest = Array.from(this.sessions.values())
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      if (oldest) {
        this.destroySession(oldest.id);
      }
    }
  }

  private appendToScrollback(session: PtySession, data: string): void {
    const lines = data.split('\n');
    session.scrollbackBuffer.push(...lines);
    if (session.scrollbackBuffer.length > this.maxScrollback) {
      session.scrollbackBuffer = session.scrollbackBuffer.slice(-this.maxScrollback);
    }
  }
}

export const ptyManager = new PtyManager();
