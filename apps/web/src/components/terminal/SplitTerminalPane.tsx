import { useState, useCallback, useEffect, useRef } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Plus, X, SplitSquareHorizontal, Clock, Circle, Loader2, MessageCircleQuestion, Play, Check, StopCircle, ArrowDown, Terminal, FileEdit, FilePen, FileText, Search, SearchCode, Wrench, ClipboardList } from 'lucide-react';
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

// Tool icons/colors mapping - using Lucide icons instead of emojis
const toolStyles: Record<string, { icon: React.ComponentType<{ size?: number; className?: string }>; color: string; bg: string }> = {
  Bash: { icon: Terminal, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  Write: { icon: FileEdit, color: 'text-green-400', bg: 'bg-green-500/10' },
  Edit: { icon: FilePen, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  Read: { icon: FileText, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  Glob: { icon: Search, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  Grep: { icon: SearchCode, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  default: { icon: Wrench, color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
};

// Parse and render structured output with markers
function ParsedOutput({ output }: { output: string }) {
  // Parse output into structured blocks
  const blocks: Array<{
    type: 'tool' | 'text' | 'output' | 'stderr' | 'raw' | 'prompt';
    tool?: string;
    command?: string;
    file?: string;
    content: string;
  }> = [];

  let currentBlock: typeof blocks[0] | null = null;
  const lines = output.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Prompt marker: @@PROMPT@@ - shows the task given to the agent
    if (line === '@@PROMPT@@') {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: 'prompt', content: '' };
      continue;
    }

    // Tool marker: @@TOOL:Name@@
    const toolMatch = line.match(/^@@TOOL:(\w+)@@$/);
    if (toolMatch) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: 'tool', tool: toolMatch[1], content: '' };
      continue;
    }

    // Command marker: @@CMD:command@@
    const cmdMatch = line.match(/^@@CMD:(.*)@@$/);
    if (cmdMatch && currentBlock?.type === 'tool') {
      currentBlock.command = cmdMatch[1];
      continue;
    }

    // File marker: @@FILE:path@@
    const fileMatch = line.match(/^@@FILE:(.*)@@$/);
    if (fileMatch && currentBlock?.type === 'tool') {
      currentBlock.file = fileMatch[1];
      continue;
    }

    // Text block: @@TEXT@@
    if (line === '@@TEXT@@') {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: 'text', content: '' };
      continue;
    }

    // Output block: @@OUTPUT@@
    if (line === '@@OUTPUT@@') {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: 'output', content: '' };
      continue;
    }

    // Stderr marker: @@STDERR@@
    if (line === '@@STDERR@@') {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: 'stderr', content: '' };
      continue;
    }

    // End marker: @@END@@
    if (line === '@@END@@') {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = null;
      continue;
    }

    // Accumulate content in current block or create raw block
    if (currentBlock) {
      currentBlock.content += (currentBlock.content ? '\n' : '') + line;
    } else if (line.trim()) {
      // Raw line outside any block
      blocks.push({ type: 'raw', content: line });
    }
  }

  if (currentBlock) blocks.push(currentBlock);

  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        // Task prompt - shown at the top like a chat message
        if (block.type === 'prompt') {
          return (
            <div key={i} className="rounded-lg bg-blue-950/30 border border-blue-800/50 p-4">
              <div className="flex items-center gap-2 mb-2 text-blue-400 text-xs font-medium">
                <ClipboardList size={14} />
                <span>Task</span>
              </div>
              <div className="text-zinc-200 text-sm whitespace-pre-wrap leading-relaxed">
                {block.content}
              </div>
            </div>
          );
        }

        if (block.type === 'tool') {
          const style = toolStyles[block.tool || ''] || toolStyles.default;
          const IconComponent = style.icon;
          return (
            <div key={i} className={`rounded-md overflow-hidden border border-zinc-800 ${style.bg}`}>
              <div className={`flex items-center gap-2 px-3 py-1.5 ${style.color} border-b border-zinc-800`}>
                <IconComponent size={14} />
                <span className="font-semibold">{block.tool}</span>
                {block.file && (
                  <span className="text-zinc-400 text-xs truncate">{block.file}</span>
                )}
              </div>
              {block.command && (
                <div className="px-3 py-2 font-mono text-sm">
                  <span className="text-green-400">$</span>
                  <span className="text-zinc-200 ml-2">{block.command}</span>
                </div>
              )}
            </div>
          );
        }

        if (block.type === 'text') {
          return (
            <div key={i} className="text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {block.content}
            </div>
          );
        }

        if (block.type === 'output') {
          const outputLines = (block.content || '(no output)').split('\n');
          return (
            <div key={i} className="bg-zinc-900/50 rounded overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-xs">
                  <tbody>
                    {outputLines.map((line, lineNum) => (
                      <tr key={lineNum} className="hover:bg-zinc-800/50">
                        <td className="text-zinc-600 text-right pr-3 pl-2 py-0.5 select-none border-r border-zinc-800 w-10">
                          {lineNum + 1}
                        </td>
                        <td className="text-zinc-400 pl-3 pr-2 py-0.5 whitespace-pre">
                          {line || ' '}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        if (block.type === 'stderr') {
          return (
            <div key={i} className="bg-red-950/30 border border-red-900/50 rounded px-3 py-2 font-mono text-xs text-red-400 whitespace-pre-wrap">
              {block.content}
            </div>
          );
        }

        // Raw content - apply basic highlighting
        return (
          <div key={i} className="text-zinc-400 font-mono text-sm">
            {block.content}
          </div>
        );
      })}
    </div>
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
    <div className="absolute inset-0 flex flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-zinc-900 border-b border-zinc-800">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
          session.status === 'running' ? 'bg-green-500 animate-pulse' :
          session.status === 'completed' ? 'bg-emerald-500' : 'bg-red-500'
        }`} />
        <span className={`text-xs font-medium ${
          session.status === 'running' ? 'text-green-400' :
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
      <div className="flex-1 relative">
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-y-auto overflow-x-hidden"
        >
          <div className="p-4 text-sm">
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
            className="absolute bottom-4 right-4 p-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-full shadow-lg transition-all"
            title="Scroll to bottom"
          >
            <ArrowDown size={16} className="text-zinc-300" />
          </button>
        )}
      </div>
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

  const renderPanel = (panel: TerminalPanel) => {
    const terminalSession = panel.sessionId ? sessions.get(panel.sessionId) : null;
    const printSession = panel.printSessionId ? printSessions.find(p => p.id === panel.printSessionId) : null;
    const availableTerminalSessions = filteredSessions.filter(
      (s) => !panels.some((p) => p.sessionId === s.id) || s.id === panel.sessionId
    );

    // Current selection value for the dropdown
    const currentValue = panel.sessionId ? `terminal:${panel.sessionId}` : panel.printSessionId ? `print:${panel.printSessionId}` : '';

    return (
      <div
        key={panel.id}
        className={`flex flex-col h-full ${
          activePanelId === panel.id ? 'ring-1 ring-blue-500/50' : ''
        }`}
        onClick={() => setActivePanelId(panel.id)}
      >
        {/* Panel header */}
        <div className={`flex items-center gap-1 px-2 py-1 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-300 dark:border-zinc-700 ${terminalSession?.rateLimit?.isLimited ? 'border-b-amber-500' : ''}`}>
          {terminalSession?.rateLimit?.isLimited && (
            <Clock size={14} className="text-amber-500 animate-pulse" />
          )}
          {/* Session selector - shows both print sessions and terminal sessions */}
          <select
            value={currentValue}
            onChange={(e) => {
              const val = e.target.value;
              if (val.startsWith('terminal:')) {
                assignToPanel(panel.id, 'terminal', val.replace('terminal:', ''));
              } else if (val.startsWith('print:')) {
                assignToPanel(panel.id, 'print', val.replace('print:', ''));
              }
            }}
            className="flex-1 bg-white dark:bg-zinc-900 text-sm px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 focus:outline-none focus:border-blue-500"
          >
            <option value="">Select terminal...</option>
            {printSessions.length > 0 && (
              <optgroup label="Agent Sessions">
                {printSessions.map((ps) => {
                  const status = ps.status === 'running' ? '▶' : ps.status === 'completed' ? '✓' : '✗';
                  const taskPreview = ps.task.slice(0, 30) + (ps.task.length > 30 ? '...' : '');
                  return (
                    <option key={ps.id} value={`print:${ps.id}`}>
                      {status} {taskPreview}
                    </option>
                  );
                })}
              </optgroup>
            )}
            {availableTerminalSessions.length > 0 && (
              <optgroup label="Interactive Terminals">
                {availableTerminalSessions.map((s) => {
                  const name = s.name || s.cwd.split('/').pop() || s.id.slice(0, 8);
                  const suffix = s.rateLimit?.isLimited ? ' (paused)' : s.isClaudeSession ? ' (claude)' : '';
                  return (
                    <option key={s.id} value={`terminal:${s.id}`}>
                      {name}{suffix}
                    </option>
                  );
                })}
              </optgroup>
            )}
          </select>

          {/* Status indicator */}
          {terminalSession && <StatusIndicator status={terminalSession.activityStatus} />}
          {printSession && (
            <span className={`w-2 h-2 rounded-full ${
              printSession.status === 'running' ? 'bg-green-500 animate-pulse' :
              printSession.status === 'completed' ? 'bg-blue-500' : 'bg-red-500'
            }`} />
          )}

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

          {terminalSession && (
            <>
              {/* Quick action buttons */}
              <div className="flex items-center gap-0.5 mx-1 px-1 border-l border-r border-zinc-300 dark:border-zinc-600">
                <button
                  onClick={() => sendTerminalInput(terminalSession.id, '\r')}
                  disabled={!isConnected}
                  className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
                  title="Continue (send Enter)"
                >
                  <Play size={14} />
                </button>
                <button
                  onClick={() => sendTerminalInput(terminalSession.id, 'y')}
                  disabled={!isConnected}
                  className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
                  title="Approve (send 'y')"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => sendTerminalInput(terminalSession.id, '\x03')}
                  disabled={!isConnected}
                  className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
                  title="Stop (send Ctrl+C)"
                >
                  <StopCircle size={14} />
                </button>
              </div>

              <button
                onClick={() => closeTerminal(terminalSession.id)}
                className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
                title="Close terminal"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>

        {/* Terminal/Print Session content */}
        <div className="flex-1 relative">
          {printSession && activeProjectId ? (
            <PrintSessionViewer session={printSession} projectId={activeProjectId} />
          ) : terminalSession ? (
            <TerminalInstance
              sessionId={terminalSession.id}
              send={send}
              subscribe={subscribe}
              isActive={activePanelId === panel.id}
              readOnly={terminalSession.isClaudeSession !== false}
              rateLimit={terminalSession.rateLimit}
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

  if (panels.length === 1) {
    return (
      <div className="h-full bg-zinc-50 dark:bg-zinc-900 flex flex-col">
        <div className="flex-1">{renderPanel(panels[0])}</div>
      </div>
    );
  }

  return (
    <div className="h-full bg-zinc-50 dark:bg-zinc-900 flex flex-col">
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
