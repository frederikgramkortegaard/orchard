import WebSocket from 'ws';
import { EventEmitter } from 'events';

const DAEMON_URL = 'ws://localhost:3002';
const RECONNECT_INTERVAL = 2000;

export interface DaemonSession {
  id: string;
  worktreeId: string;
  projectPath: string;
  cwd: string;
  createdAt: string;
  subscriberCount?: number;
}

type MessageHandler = (data: any) => void;

class DaemonClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnecting = false;
  private messageHandlers = new Map<string, Set<MessageHandler>>();
  private pendingRequests = new Map<string, { resolve: Function; reject: Function }>();
  private clientSubscribers = new Map<string, Set<WebSocket>>(); // sessionId -> client websockets

  constructor() {
    super();
    this.connect();
  }

  private connect() {
    if (this.reconnecting) return;

    try {
      this.ws = new WebSocket(DAEMON_URL);

      this.ws.on('open', () => {
        console.log('Connected to terminal daemon');
        this.connected = true;
        this.reconnecting = false;
        this.emit('connected');

        // Re-subscribe to all sessions that have active client subscribers
        this.resubscribeAllSessions();
      });

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(msg);
        } catch (err) {
          console.error('Error parsing daemon message:', err);
        }
      });

      this.ws.on('close', () => {
        console.log('Disconnected from terminal daemon');
        this.connected = false;
        this.ws = null;
        this.emit('disconnected');
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('Daemon connection error:', err.message);
        this.connected = false;
      });
    } catch (err) {
      console.error('Failed to connect to daemon:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    console.log(`Reconnecting to daemon in ${RECONNECT_INTERVAL}ms...`);
    setTimeout(() => {
      this.reconnecting = false;
      this.connect();
    }, RECONNECT_INTERVAL);
  }

  private handleMessage(msg: any) {
    // Handle responses to requests
    if (msg.type === 'session:created' || msg.type === 'session:destroyed' ||
        msg.type === 'session:list' || msg.type === 'session:info' ||
        msg.type === 'session:error') {
      const requestId = msg.requestId;
      if (requestId && this.pendingRequests.has(requestId)) {
        const { resolve, reject } = this.pendingRequests.get(requestId)!;
        this.pendingRequests.delete(requestId);
        if (msg.type === 'session:error') {
          reject(new Error(msg.error));
        } else {
          resolve(msg);
        }
        return;
      }
    }

    // Handle task completion notifications from daemon
    if (msg.type === 'agent:task-complete') {
      console.log(`Task complete: session ${msg.sessionId}, worktree ${msg.worktreeId}`);
      this.emit('task-complete', msg);
      // Forward to all client subscribers
      this.clientSubscribers.forEach((subscribers) => {
        const message = JSON.stringify(msg);
        subscribers.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      });
      return;
    }

    // Handle rate limit notifications from daemon
    if (msg.type === 'agent:rate-limited') {
      console.log(`Rate limit detected: session ${msg.rateLimit.sessionId}, worktree ${msg.rateLimit.worktreeId}`);
      this.emit('rate-limited', msg);
      // Forward to all client subscribers
      this.clientSubscribers.forEach((subscribers) => {
        const message = JSON.stringify(msg);
        subscribers.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      });
      return;
    }

    // Handle rate limit cleared notifications from daemon
    if (msg.type === 'agent:rate-limit-cleared') {
      console.log(`Rate limit cleared: session ${msg.sessionId}, worktree ${msg.worktreeId}`);
      this.emit('rate-limit-cleared', msg);
      // Forward to all client subscribers
      this.clientSubscribers.forEach((subscribers) => {
        const message = JSON.stringify(msg);
        subscribers.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      });
      return;
    }

    // Handle agent ready notifications from daemon
    if (msg.type === 'agent:ready') {
      console.log(`Agent ready: session ${msg.sessionId}, worktree ${msg.worktreeId}`);
      this.emit('agent-ready', msg);
      // Forward to all client subscribers
      this.clientSubscribers.forEach((subscribers) => {
        const message = JSON.stringify(msg);
        subscribers.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      });
      return;
    }

    // Handle terminal data - forward to client subscribers
    if (msg.type === 'terminal:data' || msg.type === 'terminal:scrollback' ||
        msg.type === 'terminal:exit' || msg.type === 'terminal:error') {
      const sessionId = msg.sessionId;
      const subscribers = this.clientSubscribers.get(sessionId);
      if (subscribers) {
        const message = JSON.stringify(msg);
        subscribers.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      }
      return;
    }

    // Emit for any other handlers
    this.emit(msg.type, msg);
  }

  private send(msg: any): void {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async request(msg: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.connected) {
        reject(new Error('Not connected to daemon'));
        return;
      }

      const requestId = crypto.randomUUID();
      msg.requestId = requestId;
      this.pendingRequests.set(requestId, { resolve, reject });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 10000);

      this.send(msg);
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Re-subscribe to all sessions that have active client subscribers.
   * Called when reconnecting to the daemon.
   */
  private resubscribeAllSessions(): void {
    for (const [sessionId, subscribers] of this.clientSubscribers) {
      if (subscribers.size > 0) {
        console.log(`Re-subscribing to session ${sessionId} after daemon reconnect`);
        this.send({ type: 'terminal:subscribe', sessionId });
      }
    }
  }

  // Session management
  async createSession(worktreeId: string, projectPath: string, cwd: string, initialCommand?: string): Promise<string> {
    const response = await this.request({
      type: 'session:create',
      worktreeId,
      projectPath,
      cwd,
      initialCommand,
    });
    return response.session.id;
  }

  async destroySession(sessionId: string): Promise<boolean> {
    try {
      await this.request({ type: 'session:destroy', sessionId });
      this.clientSubscribers.delete(sessionId);
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<DaemonSession[]> {
    const response = await this.request({ type: 'session:list' });
    return response.sessions;
  }

  async getSession(sessionId: string): Promise<DaemonSession | null> {
    try {
      const response = await this.request({ type: 'session:get', sessionId });
      return response.session;
    } catch {
      return null;
    }
  }

  // Terminal I/O - these don't need responses
  subscribeToSession(sessionId: string, clientWs: WebSocket): void {
    // Track client subscriber
    if (!this.clientSubscribers.has(sessionId)) {
      this.clientSubscribers.set(sessionId, new Set());
    }
    this.clientSubscribers.get(sessionId)!.add(clientWs);

    // Subscribe to daemon
    this.send({ type: 'terminal:subscribe', sessionId });
  }

  unsubscribeFromSession(sessionId: string, clientWs: WebSocket): void {
    const subscribers = this.clientSubscribers.get(sessionId);
    if (subscribers) {
      subscribers.delete(clientWs);
      if (subscribers.size === 0) {
        this.clientSubscribers.delete(sessionId);
        this.send({ type: 'terminal:unsubscribe', sessionId });
      }
    }
  }

  writeToSession(sessionId: string, data: string): void {
    this.send({ type: 'terminal:input', sessionId, data });
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    this.send({ type: 'terminal:resize', sessionId, cols, rows });
  }

  acknowledgeData(sessionId: string, count: number): void {
    this.send({ type: 'terminal:ack', sessionId, count });
  }

  // Get sessions for a specific worktree
  // If worktreeId doesn't match any sessions, falls back to matching by path
  async getSessionsForWorktree(worktreeId: string, path?: string): Promise<DaemonSession[]> {
    const sessions = await this.listSessions();

    // First try matching by worktreeId
    const byWorktreeId = sessions.filter(s => s.worktreeId === worktreeId);
    if (byWorktreeId.length > 0) {
      return byWorktreeId;
    }

    // Fall back to matching by cwd path (handles sessions with old random UUIDs)
    if (path) {
      return sessions.filter(s => s.cwd === path);
    }

    return [];
  }

  /**
   * Wait for a Claude agent session to be ready for input.
   * Returns a promise that resolves when the agent shows its input prompt,
   * or rejects after the timeout.
   */
  waitForAgentReady(sessionId: string, timeoutMs: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.removeListener('agent-ready', handler);
        reject(new Error(`Timeout waiting for agent ready on session ${sessionId}`));
      }, timeoutMs);

      const handler = (msg: any) => {
        if (msg.sessionId === sessionId) {
          clearTimeout(timeoutId);
          this.removeListener('agent-ready', handler);
          resolve();
        }
      };

      this.on('agent-ready', handler);
    });
  }
}

export const daemonClient = new DaemonClient();
