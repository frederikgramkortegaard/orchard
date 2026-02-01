import { useState, useCallback, useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Plus, X, SplitSquareHorizontal, Square, Clock, Circle, Loader2, MessageCircleQuestion, Play, Check, StopCircle } from 'lucide-react';
import { useTerminalStore, type TerminalActivityStatus } from '../../stores/terminal.store';
import { TerminalInstance } from './TerminalInstance';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useToast } from '../../contexts/ToastContext';

// Status indicator component
function StatusIndicator({ status }: { status?: TerminalActivityStatus }) {
  if (!status || status === 'idle') {
    return (
      <span className="flex items-center gap-1 text-xs text-green-500">
        <Circle size={8} className="fill-current" />
        <span className="hidden sm:inline">Idle</span>
      </span>
    );
  }

  if (status === 'running') {
    return (
      <span className="flex items-center gap-1 text-xs text-blue-500">
        <Loader2 size={12} className="animate-spin" />
        <span className="hidden sm:inline">Running...</span>
      </span>
    );
  }

  if (status === 'waiting') {
    return (
      <span className="flex items-center gap-1 text-xs text-amber-500">
        <MessageCircleQuestion size={12} />
        <span className="hidden sm:inline">Waiting</span>
      </span>
    );
  }

  return null;
}

interface SplitTerminalPaneProps {
  worktreeId?: string;
  worktreePath?: string;
  projectPath?: string;
}

interface TerminalPanel {
  id: string;
  sessionId: string | null;
}

export function SplitTerminalPane({ worktreeId, worktreePath, projectPath }: SplitTerminalPaneProps) {
  const { send, subscribe, isConnected, connectionId } = useWebSocket();
  const { sessions, addSession, removeSession, setSessionRateLimited, clearSessionRateLimit } = useTerminalStore();
  const { addToast } = useToast();
  const [panels, setPanels] = useState<TerminalPanel[]>([{ id: 'left', sessionId: null }]);
  const [activePanelId, setActivePanelId] = useState('left');
  const [isCreating, setIsCreating] = useState(false);

  // Subscribe to rate limit events
  useEffect(() => {
    const unsubRateLimited = subscribe('agent:rate-limited', (msg: any) => {
      const { rateLimit } = msg;
      setSessionRateLimited(rateLimit.sessionId, {
        isLimited: true,
        message: rateLimit.message,
        detectedAt: rateLimit.detectedAt,
      });
    });

    const unsubRateLimitCleared = subscribe('agent:rate-limit-cleared', (msg: any) => {
      clearSessionRateLimit(msg.sessionId);
    });

    return () => {
      unsubRateLimited();
      unsubRateLimitCleared();
    };
  }, [subscribe, setSessionRateLimited, clearSessionRateLimit]);

  // Reset panels and fetch existing sessions when worktree changes
  // NOTE: Only the orchestrator creates sessions - UI just views them
  useEffect(() => {
    // Reset panels when switching worktrees
    setPanels([{ id: 'left', sessionId: null }]);
    setActivePanelId('left');

    if (!worktreeId) return;

    const fetchExistingSessions = async () => {
      try {
        // Fetch existing sessions for this worktree (don't create new ones)
        // Also pass worktreePath to match sessions by cwd if worktreeId doesn't match (handles orphaned sessions with old IDs)
        console.log('[SplitTerminalPane] Fetching sessions for worktree:', worktreeId);
        const url = new URL(`/api/terminals/worktree/${encodeURIComponent(worktreeId)}`, window.location.origin);
        if (worktreePath) {
          url.searchParams.set('path', worktreePath);
        }
        const res = await fetch(url.toString());
        if (res.ok) {
          const existingSessions = await res.json();
          console.log('[SplitTerminalPane] Found sessions:', existingSessions.length, existingSessions);
          existingSessions.forEach((session: any) => {
            console.log('[SplitTerminalPane] Adding session:', session.id);
            addSession({
              id: session.id,
              worktreeId: session.worktreeId,
              cwd: session.cwd,
              createdAt: session.createdAt,
              isConnected: true,
              isClaudeSession: true, // Existing sessions are likely Claude sessions (conservative default)
            });
          });

          // Auto-select first session if available
          if (existingSessions.length > 0) {
            setPanels([{ id: 'left', sessionId: existingSessions[0].id }]);
          }
        } else {
          console.error('[SplitTerminalPane] Failed to fetch sessions:', res.status, res.statusText);
        }
      } catch (err) {
        console.error('[SplitTerminalPane] Failed to fetch sessions:', err);
      }
    };

    fetchExistingSessions();
  }, [worktreeId, worktreePath]); // Depend on worktreeId and worktreePath for path-based fallback matching

  // Filter to only show terminals for current worktree, exclude orchestrator terminals
  const filteredSessions = worktreeId
    ? Array.from(sessions.values()).filter(
        (s) => s.worktreeId === worktreeId && !s.worktreeId.startsWith('orchestrator-')
      )
    : Array.from(sessions.values()).filter(
        (s) => !s.worktreeId.startsWith('orchestrator-')
      );

  const createTerminal = useCallback(async (panelId: string) => {
    if (!worktreeId || !worktreePath || !projectPath) return;

    setIsCreating(true);
    try {
      const res = await fetch('/api/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worktreeId,
          projectPath,
          cwd: worktreePath,
        }),
      });

      if (res.ok) {
        const session = await res.json();

        // Generate terminal name: worktreename-N (where N is next available number)
        const worktreeName = worktreePath?.split('/').pop() || 'terminal';
        const existingCustomTerminals = Array.from(sessions.values()).filter(
          s => s.worktreeId === worktreeId && s.isClaudeSession === false
        );
        const terminalNumber = existingCustomTerminals.length + 1;
        const terminalName = `${worktreeName}-${terminalNumber}`;

        addSession({
          id: session.id,
          worktreeId: session.worktreeId,
          cwd: session.cwd,
          createdAt: session.createdAt,
          isConnected: true,
          isClaudeSession: false, // Manually created terminals are not Claude sessions
          name: terminalName,
        });

        // Assign to panel
        setPanels((prev) =>
          prev.map((p) => (p.id === panelId ? { ...p, sessionId: session.id } : p))
        );

        addToast('success', `Terminal "${terminalName}" created`);
      } else {
        addToast('error', 'Failed to create terminal');
      }
    } catch (err) {
      console.error('Failed to create terminal:', err);
      addToast('error', 'Failed to create terminal');
    } finally {
      setIsCreating(false);
    }
  }, [worktreeId, worktreePath, projectPath, addSession, addToast]);

  const closeTerminal = useCallback(async (sessionId: string) => {
    try {
      await fetch(`/api/terminals/${sessionId}`, { method: 'DELETE' });
      removeSession(sessionId);

      // Clear from panels
      setPanels((prev) =>
        prev.map((p) => (p.sessionId === sessionId ? { ...p, sessionId: null } : p))
      );
    } catch (err) {
      console.error('Failed to close terminal:', err);
    }
  }, [removeSession]);

  const splitPane = useCallback(() => {
    if (panels.length >= 2) return;
    setPanels((prev) => [...prev, { id: 'right', sessionId: null }]);
  }, [panels.length]);

  const unsplitPane = useCallback((panelId: string) => {
    if (panels.length <= 1) return;

    const panel = panels.find((p) => p.id === panelId);
    if (panel?.sessionId) {
      closeTerminal(panel.sessionId);
    }

    setPanels((prev) => prev.filter((p) => p.id !== panelId));
    setActivePanelId(panels.find((p) => p.id !== panelId)?.id || 'left');
  }, [panels, closeTerminal]);

  const assignSessionToPanel = useCallback((panelId: string, sessionId: string) => {
    setPanels((prev) =>
      prev.map((p) => (p.id === panelId ? { ...p, sessionId } : p))
    );
  }, []);

  // Send input to terminal (for quick action buttons)
  const sendTerminalInput = useCallback((sessionId: string, data: string) => {
    send({ type: 'terminal:input', sessionId, data });
  }, [send]);

  const renderPanel = (panel: TerminalPanel) => {
    const session = panel.sessionId ? sessions.get(panel.sessionId) : null;
    const availableSessions = filteredSessions.filter(
      (s) => !panels.some((p) => p.sessionId === s.id) || s.id === panel.sessionId
    );

    return (
      <div
        key={panel.id}
        className={`flex flex-col h-full ${
          activePanelId === panel.id ? 'ring-1 ring-blue-500/50' : ''
        }`}
        onClick={() => setActivePanelId(panel.id)}
      >
        {/* Panel header */}
        <div className={`flex items-center gap-1 px-2 py-1 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-300 dark:border-zinc-700 ${session?.rateLimit?.isLimited ? 'border-b-amber-500' : ''}`}>
          {session?.rateLimit?.isLimited && (
            <Clock size={14} className="text-amber-500 animate-pulse" />
          )}
          {/* Session selector */}
          <select
            value={panel.sessionId || ''}
            onChange={(e) => {
              if (e.target.value) {
                assignSessionToPanel(panel.id, e.target.value);
              }
            }}
            className="flex-1 bg-white dark:bg-zinc-900 text-sm px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 focus:outline-none focus:border-blue-500"
          >
            <option value="">Select terminal...</option>
            {availableSessions.map((s) => {
              // Use session name if available, otherwise fall back to cwd or id
              const name = s.name || s.cwd.split('/').pop() || s.id.slice(0, 8);
              const suffix = s.rateLimit?.isLimited ? ' (paused)' : s.isClaudeSession ? ' (claude)' : '';
              return (
                <option key={s.id} value={s.id}>
                  {name}{suffix}
                </option>
              );
            })}
          </select>

          {/* Status indicator */}
          {session && <StatusIndicator status={session.activityStatus} />}

          <button
            onClick={() => createTerminal(panel.id)}
            disabled={isCreating || !worktreeId || !projectPath || !isConnected}
            className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
            title="New terminal"
          >
            <Plus size={14} />
          </button>

          {panels.length === 1 ? (
            <button
              onClick={splitPane}
              className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
              title="Split terminal"
            >
              <SplitSquareHorizontal size={14} />
            </button>
          ) : (
            <button
              onClick={() => unsplitPane(panel.id)}
              className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
              title="Close split"
            >
              <X size={14} />
            </button>
          )}

          {session && (
            <>
              {/* Quick action buttons */}
              <div className="flex items-center gap-0.5 mx-1 px-1 border-l border-r border-zinc-300 dark:border-zinc-600">
                <button
                  onClick={() => sendTerminalInput(session.id, '\r')}
                  disabled={!isConnected}
                  className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
                  title="Continue (send Enter)"
                >
                  <Play size={14} />
                </button>
                <button
                  onClick={() => sendTerminalInput(session.id, 'y')}
                  disabled={!isConnected}
                  className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
                  title="Approve (send 'y')"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => sendTerminalInput(session.id, '\x03')}
                  disabled={!isConnected}
                  className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
                  title="Stop (send Ctrl+C)"
                >
                  <StopCircle size={14} />
                </button>
              </div>

              <button
                onClick={() => closeTerminal(session.id)}
                className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
                title="Stop & close terminal (kills process)"
              >
                <Square size={12} className="fill-current" />
              </button>
              <button
                onClick={() => closeTerminal(session.id)}
                className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
                title="Close terminal tab"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>

        {/* Terminal content */}
        <div className="flex-1 relative">
          {session ? (
            <TerminalInstance
              sessionId={session.id}
              send={send}
              subscribe={subscribe}
              isActive={activePanelId === panel.id}
              readOnly={session.isClaudeSession !== false}
              rateLimit={session.rateLimit}
              connectionId={connectionId}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              <button
                onClick={() => createTerminal(panel.id)}
                disabled={!worktreeId || !projectPath || !isConnected}
                className="px-4 py-2 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
              >
                Create Terminal
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Show disconnected banner but still allow viewing sessions
  const disconnectedBanner = !isConnected && (
    <div className="px-2 py-1 bg-red-500/10 border-b border-red-500/20 text-red-500 text-sm text-center">
      WebSocket disconnected - reconnecting...
    </div>
  );

  if (panels.length === 1) {
    return (
      <div className="h-full bg-zinc-50 dark:bg-zinc-900 flex flex-col">
        {disconnectedBanner}
        <div className="flex-1">{renderPanel(panels[0])}</div>
      </div>
    );
  }

  return (
    <div className="h-full bg-zinc-50 dark:bg-zinc-900 flex flex-col">
      {disconnectedBanner}
      <Group orientation="horizontal" className="flex-1">
      <Panel defaultSize={50} minSize={5}>
        {renderPanel(panels[0])}
      </Panel>
      <Separator className="w-1 bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600 cursor-col-resize" />
      <Panel defaultSize={50} minSize={5}>
        {renderPanel(panels[1])}
      </Panel>
    </Group>
    </div>
  );
}
