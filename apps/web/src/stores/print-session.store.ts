import { create } from 'zustand';
import { PrintSession, getPrintSessionsForWorktree, getPrintSessionOutput } from '../api/print-sessions';

interface PrintSessionState {
  sessions: Map<string, PrintSession>;
  outputs: Map<string, string>; // sessionId -> accumulated output
  lastIds: Map<string, number>; // sessionId -> last chunk ID for polling
  activeSessionId: string | null;
  pollingIntervals: Map<string, ReturnType<typeof setInterval>>;

  // Actions
  loadSessionsForWorktree: (projectId: string, worktreeId: string) => Promise<void>;
  addSession: (session: PrintSession) => void;
  setActiveSession: (sessionId: string | null) => void;
  appendOutput: (sessionId: string, output: string, lastId: number) => void;
  startPolling: (projectId: string, sessionId: string) => void;
  stopPolling: (sessionId: string) => void;
  getSessionsForWorktree: (worktreeId: string) => PrintSession[];
}

export const usePrintSessionStore = create<PrintSessionState>((set, get) => ({
  sessions: new Map(),
  outputs: new Map(),
  lastIds: new Map(),
  activeSessionId: null,
  pollingIntervals: new Map(),

  loadSessionsForWorktree: async (projectId, worktreeId) => {
    try {
      const sessions = await getPrintSessionsForWorktree(projectId, worktreeId);
      set((state) => {
        const newSessions = new Map(state.sessions);
        for (const session of sessions) {
          newSessions.set(session.id, session);
        }
        return { sessions: newSessions };
      });
    } catch (error) {
      console.error('Failed to load print sessions:', error);
    }
  },

  addSession: (session) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.set(session.id, session);
      return { sessions, activeSessionId: session.id };
    });
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId });
  },

  appendOutput: (sessionId, output, lastId) => {
    set((state) => {
      const outputs = new Map(state.outputs);
      const lastIds = new Map(state.lastIds);
      const existing = outputs.get(sessionId) || '';
      outputs.set(sessionId, existing + output);
      lastIds.set(sessionId, lastId);
      return { outputs, lastIds };
    });
  },

  startPolling: (projectId, sessionId) => {
    const state = get();
    if (state.pollingIntervals.has(sessionId)) return;

    const poll = async () => {
      try {
        const lastId = get().lastIds.get(sessionId) || 0;
        const response = await getPrintSessionOutput(projectId, sessionId, lastId);

        if (response.chunks.length > 0) {
          const newOutput = response.chunks.map(c => c.chunk).join('');
          get().appendOutput(sessionId, newOutput, response.lastId);
        }

        // Update session status
        const session = get().sessions.get(sessionId);
        if (session && session.status !== response.status) {
          set((state) => {
            const sessions = new Map(state.sessions);
            sessions.set(sessionId, { ...session, status: response.status as PrintSession['status'] });
            return { sessions };
          });
        }

        // Stop polling if session is complete
        if (response.status !== 'running') {
          get().stopPolling(sessionId);
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    };

    // Poll immediately, then every 500ms
    poll();
    const interval = setInterval(poll, 500);
    set((state) => {
      const pollingIntervals = new Map(state.pollingIntervals);
      pollingIntervals.set(sessionId, interval);
      return { pollingIntervals };
    });
  },

  stopPolling: (sessionId) => {
    const interval = get().pollingIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      set((state) => {
        const pollingIntervals = new Map(state.pollingIntervals);
        pollingIntervals.delete(sessionId);
        return { pollingIntervals };
      });
    }
  },

  getSessionsForWorktree: (worktreeId) => {
    return Array.from(get().sessions.values()).filter(s => s.worktreeId === worktreeId);
  },
}));
