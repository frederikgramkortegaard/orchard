import { useState } from 'react';
import { useTerminalStore } from '../../stores/terminal.store';
import { TerminalInstance } from './TerminalInstance';
import { useWebSocket } from '../../contexts/WebSocketContext';

interface TerminalPaneProps {
  worktreeId?: string;
}

export function TerminalPane({ worktreeId }: TerminalPaneProps) {
  const { send, subscribe, isConnected } = useWebSocket();
  const { sessions, activeSessionId, setActiveSession, addSession, removeSession } = useTerminalStore();
  const [isCreating, setIsCreating] = useState(false);

  const filteredSessions = worktreeId
    ? Array.from(sessions.values()).filter(s => s.worktreeId === worktreeId)
    : Array.from(sessions.values());

  const createTerminal = async () => {
    if (!worktreeId) return;

    setIsCreating(true);
    try {
      const res = await fetch('/api/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worktreeId,
          cwd: '/tmp', // Will be worktree path later
          initialCommand: undefined,
        }),
      });

      if (res.ok) {
        const session = await res.json();
        addSession({
          id: session.id,
          worktreeId: session.worktreeId,
          cwd: session.cwd,
          createdAt: session.createdAt,
          isConnected: true,
        });
      }
    } catch (err) {
      console.error('Failed to create terminal:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const closeTerminal = async (sessionId: string) => {
    try {
      await fetch(`/api/terminals/${sessionId}`, { method: 'DELETE' });
      removeSession(sessionId);
    } catch (err) {
      console.error('Failed to close terminal:', err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-zinc-800 border-b border-zinc-700">
        {filteredSessions.map((session) => (
          <button
            key={session.id}
            onClick={() => setActiveSession(session.id)}
            className={`flex items-center gap-2 px-3 py-1 rounded text-sm ${
              activeSessionId === session.id
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${session.isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span>Terminal</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTerminal(session.id);
              }}
              className="ml-1 hover:text-red-400"
            >
              ×
            </button>
          </button>
        ))}

        <button
          onClick={createTerminal}
          disabled={isCreating || !worktreeId || !isConnected}
          className="px-2 py-1 text-zinc-400 hover:text-white hover:bg-zinc-700/50 rounded disabled:opacity-50"
        >
          +
        </button>

        {!isConnected && (
          <span className="ml-auto text-xs text-red-400">Disconnected</span>
        )}
      </div>

      {/* Terminal area */}
      <div className="flex-1 relative">
        {filteredSessions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            {worktreeId ? (
              <button
                onClick={createTerminal}
                disabled={!isConnected}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded disabled:opacity-50"
              >
                Create Terminal
              </button>
            ) : (
              <span>Select a worktree to create a terminal</span>
            )}
          </div>
        ) : (
          filteredSessions.map((session) => (
            <TerminalInstance
              key={session.id}
              sessionId={session.id}
              send={send}
              subscribe={subscribe}
              isActive={activeSessionId === session.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
