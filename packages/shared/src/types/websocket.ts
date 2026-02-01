// Client → Server messages
export type ClientMessage =
  | { type: 'ping' };

// Server → Client messages
export type ServerMessage =
  | { type: 'connected'; timestamp: number }
  | { type: 'pong'; timestamp: number }
  | { type: 'file:event'; event: import('./file').FileEvent }
  | { type: 'worktree:update'; worktree: import('./worktree').Worktree }
  | { type: 'error'; message: string };
