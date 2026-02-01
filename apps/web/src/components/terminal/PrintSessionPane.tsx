import { useState, useEffect, useRef } from 'react';
import { usePrintSessionStore } from '../../stores/print-session.store';
import { getPrintSessionsForWorktree } from '../../api/print-sessions';

interface PrintSessionPaneProps {
  projectId: string;
  worktreeId?: string;
}

export function PrintSessionPane({ projectId, worktreeId }: PrintSessionPaneProps) {
  const { sessions, outputs, activeSessionId, setActiveSession, addSession, startPolling, stopPolling } = usePrintSessionStore();
  const [loading, setLoading] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  // Load print sessions for worktree
  useEffect(() => {
    if (!worktreeId) return;

    setLoading(true);
    getPrintSessionsForWorktree(projectId, worktreeId)
      .then((fetchedSessions) => {
        fetchedSessions.forEach(session => {
          addSession(session);
          // Start polling for running sessions
          if (session.status === 'running') {
            startPolling(projectId, session.id);
          }
        });
        // Set most recent as active
        if (fetchedSessions.length > 0) {
          setActiveSession(fetchedSessions[0].id);
        }
      })
      .catch(err => console.error('Failed to load print sessions:', err))
      .finally(() => setLoading(false));

    return () => {
      // Cleanup polling on unmount
      Array.from(sessions.keys()).forEach(id => stopPolling(id));
    };
  }, [projectId, worktreeId]);

  const filteredSessions = worktreeId
    ? Array.from(sessions.values()).filter(s => s.worktreeId === worktreeId)
    : Array.from(sessions.values());

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null;
  const activeOutput = activeSessionId ? outputs.get(activeSessionId) || '' : '';

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [activeOutput]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-900 text-zinc-500">
        Loading sessions...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-zinc-800 border-b border-zinc-700 overflow-x-auto">
        {filteredSessions.map((session) => (
          <button
            key={session.id}
            onClick={() => {
              setActiveSession(session.id);
              if (session.status === 'running') {
                startPolling(projectId, session.id);
              }
            }}
            className={`flex items-center gap-2 px-3 py-1 rounded text-sm whitespace-nowrap ${
              activeSessionId === session.id
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${
              session.status === 'running' ? 'bg-green-500 animate-pulse' :
              session.status === 'completed' ? 'bg-blue-500' : 'bg-red-500'
            }`} />
            <span className="truncate max-w-[150px]" title={session.task}>
              {session.task.substring(0, 30)}{session.task.length > 30 ? '...' : ''}
            </span>
          </button>
        ))}

        {filteredSessions.length === 0 && (
          <span className="text-zinc-500 text-sm">No sessions</span>
        )}
      </div>

      {/* Output area */}
      <div className="flex-1 relative overflow-hidden">
        {activeSession ? (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 bg-zinc-800/50 border-b border-zinc-700">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 text-xs rounded ${
                  activeSession.status === 'running' ? 'bg-green-500/20 text-green-400' :
                  activeSession.status === 'completed' ? 'bg-blue-500/20 text-blue-400' :
                  'bg-red-500/20 text-red-400'
                }`}>
                  {activeSession.status}
                </span>
                <span className="text-xs text-zinc-400">
                  {new Date(activeSession.startedAt).toLocaleString()}
                </span>
              </div>
              {activeSession.exitCode !== undefined && (
                <span className={`text-xs ${activeSession.exitCode === 0 ? 'text-green-400' : 'text-red-400'}`}>
                  Exit: {activeSession.exitCode}
                </span>
              )}
            </div>
            <pre
              ref={outputRef}
              className="flex-1 p-4 overflow-auto font-mono text-sm text-zinc-100 whitespace-pre-wrap"
            >
              {activeOutput || (activeSession.status === 'running' ? 'Waiting for output...' : 'No output')}
            </pre>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-500">
            {worktreeId ? 'No sessions for this worktree' : 'Select a worktree'}
          </div>
        )}
      </div>
    </div>
  );
}
