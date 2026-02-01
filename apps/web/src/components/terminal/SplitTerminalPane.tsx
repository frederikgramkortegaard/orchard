import { useState, useCallback, useEffect, useRef } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Plus, X, SplitSquareHorizontal, Clock, Circle, Loader2, MessageCircleQuestion, Play, Check, StopCircle, ArrowDown } from 'lucide-react';
import { useTerminalStore, type TerminalActivityStatus } from '../../stores/terminal.store';
import { TerminalInstance } from './TerminalInstance';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useToast } from '../../contexts/ToastContext';
import { useProjectStore } from '../../stores/project.store';

// Print session types
interface PrintSession {
  id: string;
  worktreeId: string;
  projectId: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  exitCode?: number;
  startedAt: string;
  completedAt?: string;
}

// Simple text-based output component (no terminal styling)
function ParsedOutput({ output }: { output: string }) {
  // Strip all @@MARKER@@ tags and render as plain text
  const cleanOutput = output
    .replace(/@@(PROMPT|TOOL:\w+|CMD:.*|FILE:.*|TEXT|OUTPUT|STDERR|END)@@\n?/g, '')
    .trim();

  if (!cleanOutput) {
    return null;
  }

  return (
    <pre className="text-zinc-300 text-sm whitespace-pre-wrap font-mono leading-relaxed">
      {cleanOutput}
    </pre>
  );
}

// Read-only print session viewer component
function PrintSessionViewer({ session, projectId }: { session: PrintSession; projectId: string }) {
  const [output, setOutput] = useState('');
  const [lastId, setLastId] = useState(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Track scroll position
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atBottom = scrollHeight - scrollTop - clientHeight < 50;
      isAtBottomRef.current = atBottom;
      setShowScrollButton(!atBottom && scrollHeight > clientHeight);
    };

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  // Poll for output
  useEffect(() => {
    const fetchOutput = async () => {
      try {
        const res = await fetch(`/api/print-sessions/${session.id}/output?projectId=${projectId}&afterId=${lastId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.chunks && data.chunks.length > 0) {
            const newOutput = data.chunks.map((c: { chunk: string }) => c.chunk).join('');
            setOutput(prev => prev + newOutput);
            setLastId(data.lastId);
          }
        }
      } catch {
        // Ignore polling errors
      }
    };

    fetchOutput();
    const interval = setInterval(fetchOutput, 500);
    return () => clearInterval(interval);
  }, [session.id, projectId, lastId]);

  // Auto-scroll to bottom when new output arrives (if user is at bottom)
  useEffect(() => {
    if (containerRef.current && isAtBottomRef.current) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, [output]);

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
          session.status === 'running' ? 'bg-blue-500 animate-pulse' :
          session.status === 'completed' ? 'bg-emerald-500' : 'bg-red-500'
        }`} />
        <span className={`text-xs font-medium ${
          session.status === 'running' ? 'text-blue-400' :
          session.status === 'completed' ? 'text-emerald-400' : 'text-red-400'
        }`}>
          {session.status === 'running' ? 'Running' : session.status === 'completed' ? 'Completed' : 'Failed'}
        </span>
        <span className="text-xs text-zinc-500">•</span>
        <span className="text-xs text-zinc-400 truncate flex-1" title={session.task}>
          {session.task}
        </span>
        {session.exitCode !== undefined && (
          <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
            session.exitCode === 0
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-red-500/20 text-red-400'
          }`}>
            exit {session.exitCode}
          </span>
        )}
      </div>

      {/* Scrollable output */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div className="p-3 text-sm">
          {output ? (
            <ParsedOutput output={output} />
          ) : (
            <div className="text-zinc-500 italic">
              {session.status === 'running' ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Waiting for output...
                </span>
              ) : 'No output'}
            </div>
          )}
        </div>
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 p-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-full shadow-lg transition-all z-10"
          title="Scroll to bottom"
        >
          <ArrowDown size={16} className="text-zinc-300" />
        </button>
      )}
    </div>
  );
}

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
  sessionId: string | null;  // Terminal session ID
  printSessionId: string | null;  // Print session ID
}

export function SplitTerminalPane({ worktreeId, worktreePath, projectPath }: SplitTerminalPaneProps) {
  const { send, subscribe, isConnected, connectionId } = useWebSocket();
  const { sessions, addSession, removeSession, setSessionRateLimited, clearSessionRateLimit } = useTerminalStore();
  const { addToast } = useToast();
  const { activeProjectId } = useProjectStore();
  const [panels, setPanels] = useState<TerminalPanel[]>([{ id: 'left', sessionId: null, printSessionId: null }]);
  const [activePanelId, setActivePanelId] = useState('left');
  const [isCreating, setIsCreating] = useState(false);
  const [printSessions, setPrintSessions] = useState<PrintSession[]>([]);

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
    setPanels([{ id: 'left', sessionId: null, printSessionId: null }]);
    setActivePanelId('left');
    setPrintSessions([]);

    if (!worktreeId || !activeProjectId) return;

    const fetchExistingSessions = async () => {
      try {
        // Fetch existing terminal sessions for this worktree
        const url = new URL(`/api/terminals/worktree/${encodeURIComponent(worktreeId)}`, window.location.origin);
        if (worktreePath) {
          url.searchParams.set('path', worktreePath);
        }
        const res = await fetch(url.toString());
        if (res.ok) {
          const existingSessions = await res.json();
          existingSessions.forEach((session: any) => {
            addSession({
              id: session.id,
              worktreeId: session.worktreeId,
              cwd: session.cwd,
              createdAt: session.createdAt,
              isConnected: true,
              isClaudeSession: true,
            });
          });
        }
      } catch {
        // Session fetch failed
      }
    };

    const fetchPrintSessions = async () => {
      try {
        const res = await fetch(`/api/print-sessions?projectId=${activeProjectId}&worktreeId=${worktreeId}`);
        if (res.ok) {
          const sessions: PrintSession[] = await res.json();
          setPrintSessions(sessions);

          // Auto-select most recent print session if no terminal sessions
          if (sessions.length > 0) {
            const mostRecent = sessions.sort((a, b) =>
              new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
            )[0];
            setPanels([{ id: 'left', sessionId: null, printSessionId: mostRecent.id }]);
          }
        }
      } catch {
        // Print session fetch failed
      }
    };

    fetchExistingSessions();
    fetchPrintSessions();

    // Poll for print session updates
    const interval = setInterval(fetchPrintSessions, 3000);
    return () => clearInterval(interval);
  }, [worktreeId, worktreePath, activeProjectId, addSession]);

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

        // Assign to panel (clear printSessionId since we're using a terminal)
        setPanels((prev) =>
          prev.map((p) => (p.id === panelId ? { ...p, sessionId: session.id, printSessionId: null } : p))
        );

        addToast('success', `Terminal "${terminalName}" created`);
      } else {
        addToast('error', 'Failed to create terminal');
      }
    } catch (err) {
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
        prev.map((p) => (p.sessionId === sessionId ? { ...p, sessionId: null, printSessionId: null } : p))
      );
    } catch {
      // Session close failed silently - UI state is already updated
    }
  }, [removeSession]);

  const splitPane = useCallback(() => {
    if (panels.length >= 2) return;
    setPanels((prev) => [...prev, { id: 'right', sessionId: null, printSessionId: null }]);
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

  // Assign either a terminal session or print session to a panel
  const assignToPanel = useCallback((panelId: string, type: 'terminal' | 'print', id: string) => {
    setPanels((prev) =>
      prev.map((p) => {
        if (p.id !== panelId) return p;
        if (type === 'terminal') {
          return { ...p, sessionId: id, printSessionId: null };
        } else {
          return { ...p, sessionId: null, printSessionId: id };
        }
      })
    );
  }, []);

  // Send input to terminal (for quick action buttons)
  const sendTerminalInput = useCallback((sessionId: string, data: string) => {
    send({ type: 'terminal:input', sessionId, data });
  }, [send]);

  // Get the most recent print session to display
  const mostRecentPrintSession = printSessions.length > 0
    ? printSessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0]
    : null;

  // Simple render - just show the most recent print session
  const renderContent = () => {
    if (mostRecentPrintSession && activeProjectId) {
      return <PrintSessionViewer session={mostRecentPrintSession} projectId={activeProjectId} />;
    }

    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        No agent output yet
      </div>
    );
  };

  return (
    <div className="h-full bg-zinc-950 flex flex-col">
      {renderContent()}
    </div>
  );
}
