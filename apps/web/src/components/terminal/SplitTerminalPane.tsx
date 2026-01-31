import { useState, useCallback, useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Plus, X, SplitSquareHorizontal, Square } from 'lucide-react';
import { useTerminalStore } from '../../stores/terminal.store';
import { TerminalInstance } from './TerminalInstance';
import { useWebSocket } from '../../contexts/WebSocketContext';

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
  const { send, subscribe, isConnected } = useWebSocket();
  const { sessions, addSession, removeSession } = useTerminalStore();
  const [panels, setPanels] = useState<TerminalPanel[]>([{ id: 'left', sessionId: null }]);
  const [activePanelId, setActivePanelId] = useState('left');
  const [isCreating, setIsCreating] = useState(false);

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
        const res = await fetch(`/api/terminals/worktree/${encodeURIComponent(worktreeId)}`);
        if (res.ok) {
          const existingSessions = await res.json();
          existingSessions.forEach((session: any) => {
            if (!sessions.has(session.id)) {
              addSession({
                id: session.id,
                worktreeId: session.worktreeId,
                cwd: session.cwd,
                createdAt: session.createdAt,
                isConnected: true,
                isClaudeSession: true, // Existing sessions are likely Claude sessions (conservative default)
              });
            }
          });

          // Auto-select first session if available
          if (existingSessions.length > 0) {
            setPanels([{ id: 'left', sessionId: existingSessions[0].id }]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch sessions:', err);
      }
    };

    fetchExistingSessions();
  }, [worktreeId]); // Only depend on worktreeId to avoid loops

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
      }
    } catch (err) {
      console.error('Failed to create terminal:', err);
    } finally {
      setIsCreating(false);
    }
  }, [worktreeId, worktreePath, projectPath, addSession]);

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
        <div className="flex items-center gap-1 px-2 py-1 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-300 dark:border-zinc-700">
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
              return (
                <option key={s.id} value={s.id}>
                  {name}{s.isClaudeSession ? ' (claude)' : ''}
                </option>
              );
            })}
          </select>

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

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-50 dark:bg-zinc-900 text-red-500 dark:text-red-400">
        WebSocket disconnected
      </div>
    );
  }

  if (panels.length === 1) {
    return <div className="h-full bg-zinc-50 dark:bg-zinc-900">{renderPanel(panels[0])}</div>;
  }

  return (
    <Group orientation="horizontal" className="h-full bg-zinc-50 dark:bg-zinc-900">
      <Panel defaultSize={50} minSize={5}>
        {renderPanel(panels[0])}
      </Panel>
      <Separator className="w-1 bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600 cursor-col-resize" />
      <Panel defaultSize={50} minSize={5}>
        {renderPanel(panels[1])}
      </Panel>
    </Group>
  );
}
