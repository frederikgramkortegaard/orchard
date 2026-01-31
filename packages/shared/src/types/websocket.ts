// Client → Server messages
export type ClientMessage =
  | { type: 'terminal:input'; sessionId: string; data: string }
  | { type: 'terminal:resize'; sessionId: string; cols: number; rows: number }
  | { type: 'terminal:requestScrollback'; sessionId: string }
  | { type: 'terminal:ack'; count: number }
  | { type: 'ping' };

// Rate limit status for Claude sessions
export interface RateLimitInfo {
  sessionId: string;
  worktreeId: string;
  isLimited: boolean;
  message?: string;
  detectedAt: number;
  resumedAt?: number;
}

// Server → Client messages
export type ServerMessage =
  | { type: 'connected'; timestamp: number }
  | { type: 'pong'; timestamp: number }
  | { type: 'terminal:data'; sessionId: string; data: string; seq: number }
  | { type: 'terminal:exit'; sessionId: string; exitCode: number }
  | { type: 'terminal:scrollback'; sessionId: string; data: string[] }
  | { type: 'terminal:created'; session: import('./terminal').TerminalSession }
  | { type: 'file:event'; event: import('./file').FileEvent }
  | { type: 'worktree:update'; worktree: import('./worktree').Worktree }
  | { type: 'agent:rate-limited'; rateLimit: RateLimitInfo }
  | { type: 'agent:rate-limit-cleared'; sessionId: string; worktreeId: string; timestamp: number }
  | { type: 'error'; message: string };
