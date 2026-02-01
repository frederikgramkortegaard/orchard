import WebSocket from 'ws';
import { EventEmitter } from 'events';
import {
  retryWithBackoff,
  CircuitBreaker,
  calculateBackoffDelay,
  sleep,
  type CircuitState,
} from '../utils/retry.js';

const DAEMON_URL = 'ws://localhost:3002';

// Reconnection settings with exponential backoff
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_BACKOFF_MULTIPLIER = 2;

// Request retry settings
const REQUEST_MAX_ATTEMPTS = 3;
const REQUEST_BASE_DELAY_MS = 500;
const REQUEST_MAX_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 10000;

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
  private reconnectAttempt = 0;
  private messageHandlers = new Map<string, Set<MessageHandler>>();
  private pendingRequests = new Map<string, { resolve: Function; reject: Function }>();
  private clientSubscribers = new Map<string, Set<WebSocket>>(); // sessionId -> client websockets

  // Circuit breaker for daemon connection health
  private connectionCircuitBreaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    successThreshold: 2,
  });

  constructor() {
    super();
    this.connect();
  }

  /**
   * Get the current circuit breaker state
   */
  getCircuitState(): CircuitState {
    return this.connectionCircuitBreaker.getState();
  }

  /**
   * Get circuit breaker statistics for health monitoring
   */
  getCircuitStats(): {
    state: CircuitState;
    failureCount: number;
    reconnectAttempt: number;
  } {
    return {
      state: this.connectionCircuitBreaker.getState(),
      failureCount: this.connectionCircuitBreaker.getFailureCount(),
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  private connect() {
    if (this.reconnecting) return;

    // Check circuit breaker - if open, don't attempt connection
    if (this.connectionCircuitBreaker.isOpen()) {
      console.log('Circuit breaker is open, skipping connection attempt');
      this.scheduleReconnect();
      return;
    }

    try {
      this.ws = new WebSocket(DAEMON_URL);

      this.ws.on('open', () => {
        console.log('Connected to terminal daemon');
        this.connected = true;
        this.reconnecting = false;
        this.reconnectAttempt = 0; // Reset backoff on successful connection
        this.connectionCircuitBreaker.recordSuccess();
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
        this.connectionCircuitBreaker.recordFailure();
        this.emit('disconnected');
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('Daemon connection error:', err.message);
        this.connected = false;
        this.connectionCircuitBreaker.recordFailure();
      });
    } catch (err) {
      console.error('Failed to connect to daemon:', err);
      this.connectionCircuitBreaker.recordFailure();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;

    // Calculate backoff delay with exponential increase
    const delayMs = calculateBackoffDelay(
      this.reconnectAttempt,
      RECONNECT_BASE_DELAY_MS,
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BACKOFF_MULTIPLIER
    );
    this.reconnectAttempt++;

    const circuitState = this.connectionCircuitBreaker.getState();
    console.log(
      `Reconnecting to daemon in ${delayMs}ms (attempt ${this.reconnectAttempt}, circuit: ${circuitState})...`
    );

    setTimeout(() => {
      this.reconnecting = false;
      this.connect();
    }, delayMs);
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

  /**
   * Internal request without retry - used by retryable operations
   */
  private async requestOnce(msg: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.connected) {
        reject(new Error('Not connected to daemon'));
        return;
      }

      // Check circuit breaker before making request
      if (this.connectionCircuitBreaker.isOpen()) {
        reject(new Error('Circuit breaker is open - daemon connection unhealthy'));
        return;
      }

      const requestId = crypto.randomUUID();
      msg.requestId = requestId;
      this.pendingRequests.set(requestId, { resolve, reject });

      // Timeout after configured duration
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          this.connectionCircuitBreaker.recordFailure();
          reject(new Error('Request timeout'));
        }
      }, REQUEST_TIMEOUT_MS);

      this.send(msg);
    });
  }

  /**
   * Make a request to the daemon with automatic retry and exponential backoff
   */
  private async request(msg: any): Promise<any> {
    // Determine if an error is retryable
    const isRetryable = (error: Error): boolean => {
      const message = error.message.toLowerCase();
      // Don't retry on circuit breaker open or permanent errors
      if (message.includes('circuit breaker')) return false;
      // Retry on timeout or connection issues
      return (
        message.includes('timeout') ||
        message.includes('not connected') ||
        message.includes('connection')
      );
    };

    return retryWithBackoff(
      () => this.requestOnce({ ...msg }), // Clone msg to avoid requestId conflicts
      {
        maxAttempts: REQUEST_MAX_ATTEMPTS,
        baseDelayMs: REQUEST_BASE_DELAY_MS,
        maxDelayMs: REQUEST_MAX_DELAY_MS,
        isRetryable,
        onRetry: (attempt, delayMs, error) => {
          console.log(
            `Retrying daemon request (attempt ${attempt}/${REQUEST_MAX_ATTEMPTS}) after ${delayMs}ms: ${error.message}`
          );
        },
      }
    );
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
