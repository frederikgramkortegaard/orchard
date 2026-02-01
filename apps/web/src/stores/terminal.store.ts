import { create } from 'zustand';

export interface RateLimitStatus {
  isLimited: boolean;
  message?: string;
  detectedAt?: number;
  resumedAt?: number;
}

export type TerminalActivityStatus = 'idle' | 'running' | 'waiting';

export interface TerminalSession {
  id: string;
  worktreeId: string;
  cwd: string;
  createdAt: string;
  isConnected: boolean;
  isClaudeSession?: boolean; // If true, terminal is read-only (controlled by orchestrator)
  name?: string; // Display name for the terminal
  rateLimit?: RateLimitStatus; // Rate limit status for Claude sessions
  activityStatus?: TerminalActivityStatus; // Current activity status
  lastOutputAt?: number; // Timestamp of last output
}

interface TerminalState {
  sessions: Map<string, TerminalSession>;
  activeSessionId: string | null;

  // Actions
  addSession: (session: TerminalSession) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  setSessionConnected: (sessionId: string, connected: boolean) => void;
  setSessionRateLimited: (sessionId: string, rateLimit: RateLimitStatus) => void;
  clearSessionRateLimit: (sessionId: string) => void;
  setSessionActivity: (sessionId: string, status: TerminalActivityStatus, lastOutputAt?: number) => void;
  getSessionsForWorktree: (worktreeId: string) => TerminalSession[];
  getRateLimitedSessions: () => TerminalSession[];
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,

  addSession: (session) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.set(session.id, session);
      return { sessions, activeSessionId: session.id };
    });
  },

  removeSession: (sessionId) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.delete(sessionId);
      const activeSessionId = state.activeSessionId === sessionId
        ? (sessions.size > 0 ? sessions.keys().next().value : null)
        : state.activeSessionId;
      return { sessions, activeSessionId };
    });
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId });
  },

  setSessionConnected: (sessionId, connected) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, isConnected: connected });
      }
      return { sessions };
    });
  },

  setSessionRateLimited: (sessionId, rateLimit) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, rateLimit });
      }
      return { sessions };
    });
  },

  clearSessionRateLimit: (sessionId) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, {
          ...session,
          rateLimit: { isLimited: false, resumedAt: Date.now() },
        });
      }
      return { sessions };
    });
  },

  setSessionActivity: (sessionId, status, lastOutputAt) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, {
          ...session,
          activityStatus: status,
          lastOutputAt: lastOutputAt ?? session.lastOutputAt,
        });
      }
      return { sessions };
    });
  },

  getSessionsForWorktree: (worktreeId) => {
    return Array.from(get().sessions.values()).filter(s => s.worktreeId === worktreeId);
  },

  getRateLimitedSessions: () => {
    return Array.from(get().sessions.values()).filter(s => s.rateLimit?.isLimited);
  },
}));
