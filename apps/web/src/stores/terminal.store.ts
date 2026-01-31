import { create } from 'zustand';

export interface TerminalSession {
  id: string;
  worktreeId: string;
  cwd: string;
  createdAt: string;
  isConnected: boolean;
  isClaudeSession?: boolean; // If true, terminal is read-only (controlled by orchestrator)
  name?: string; // Display name for the terminal
}

interface TerminalState {
  sessions: Map<string, TerminalSession>;
  activeSessionId: string | null;

  // Actions
  addSession: (session: TerminalSession) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  setSessionConnected: (sessionId: string, connected: boolean) => void;
  getSessionsForWorktree: (worktreeId: string) => TerminalSession[];
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

  getSessionsForWorktree: (worktreeId) => {
    return Array.from(get().sessions.values()).filter(s => s.worktreeId === worktreeId);
  },
}));
