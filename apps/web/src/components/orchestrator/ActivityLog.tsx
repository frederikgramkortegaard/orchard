import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  RefreshCw,
  Trash2,
  FileEdit,
  Terminal,
  GitCommit,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  Bot,
  Cpu,
  MessageSquare,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface ActivityLogProps {
  projectId: string;
}

interface ActivityEntry {
  id: number;
  timestamp: string;
  type: string;
  category: string;
  summary: string;
  details: string;
}

type ActivityKind =
  | 'file_edit'
  | 'command'
  | 'commit'
  | 'question'
  | 'task_complete'
  | 'error'
  | 'progress'
  | 'orchestrator'
  | 'system'
  | 'default';

function getActivityKind(entry: ActivityEntry): ActivityKind {
  const detailsObj = JSON.parse(entry.details || '{}');
  const summary = entry.summary.toLowerCase();

  // Agent-specific activities
  if (detailsObj.activityType) {
    return detailsObj.activityType as ActivityKind;
  }

  // Infer from summary/category
  if (summary.includes('completed') || summary.includes('task complete')) {
    return 'task_complete';
  }
  if (summary.includes('question')) {
    return 'question';
  }
  if (summary.includes('commit')) {
    return 'commit';
  }
  if (summary.includes('edit') || summary.includes('modified') || summary.includes('wrote')) {
    return 'file_edit';
  }
  if (summary.includes('command') || summary.includes('ran') || summary.includes('executed')) {
    return 'command';
  }
  if (entry.type === 'error') {
    return 'error';
  }
  if (summary.includes('progress')) {
    return 'progress';
  }
  if (entry.category === 'orchestrator') {
    return 'orchestrator';
  }
  if (entry.category === 'system') {
    return 'system';
  }

  return 'default';
}

function getActivityIcon(kind: ActivityKind) {
  switch (kind) {
    case 'file_edit':
      return <FileEdit size={12} />;
    case 'command':
      return <Terminal size={12} />;
    case 'commit':
      return <GitCommit size={12} />;
    case 'question':
      return <HelpCircle size={12} />;
    case 'task_complete':
      return <CheckCircle2 size={12} />;
    case 'error':
      return <AlertCircle size={12} />;
    case 'progress':
      return <Bot size={12} />;
    case 'orchestrator':
      return <Cpu size={12} />;
    case 'system':
      return <MessageSquare size={12} />;
    default:
      return <Activity size={12} />;
  }
}

function getActivityColors(kind: ActivityKind) {
  switch (kind) {
    case 'file_edit':
      return {
        icon: 'text-blue-500 dark:text-blue-400',
        bg: 'bg-blue-100 dark:bg-blue-900/30',
      };
    case 'command':
      return {
        icon: 'text-purple-500 dark:text-purple-400',
        bg: 'bg-purple-100 dark:bg-purple-900/30',
      };
    case 'commit':
      return {
        icon: 'text-orange-500 dark:text-orange-400',
        bg: 'bg-orange-100 dark:bg-orange-900/30',
      };
    case 'question':
      return {
        icon: 'text-yellow-500 dark:text-yellow-400',
        bg: 'bg-yellow-100 dark:bg-yellow-900/30',
      };
    case 'task_complete':
      return {
        icon: 'text-green-500 dark:text-green-400',
        bg: 'bg-green-100 dark:bg-green-900/30',
      };
    case 'error':
      return {
        icon: 'text-red-500 dark:text-red-400',
        bg: 'bg-red-100 dark:bg-red-900/30',
      };
    case 'progress':
      return {
        icon: 'text-cyan-500 dark:text-cyan-400',
        bg: 'bg-cyan-100 dark:bg-cyan-900/30',
      };
    case 'orchestrator':
      return {
        icon: 'text-indigo-500 dark:text-indigo-400',
        bg: 'bg-indigo-100 dark:bg-indigo-900/30',
      };
    case 'system':
      return {
        icon: 'text-zinc-500 dark:text-zinc-400',
        bg: 'bg-zinc-100 dark:bg-zinc-800/50',
      };
    default:
      return {
        icon: 'text-zinc-500 dark:text-zinc-400',
        bg: 'bg-zinc-100 dark:bg-zinc-800/50',
      };
  }
}

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

function extractAgentBranch(entry: ActivityEntry): string | null {
  const detailsObj = JSON.parse(entry.details || '{}');
  return detailsObj.branch || detailsObj.worktreeId?.split('-')[0] || null;
}

function getEntrySource(entry: ActivityEntry): string {
  if (entry.category === 'orchestrator') {
    return 'Orchestrator';
  }
  if (entry.category === 'system') {
    return 'System';
  }
  const branch = extractAgentBranch(entry);
  if (branch) {
    return branch;
  }
  if (entry.category === 'agent') {
    return 'Agent';
  }
  return 'General';
}

interface GroupedEntries {
  source: string;
  entries: ActivityEntry[];
}

function groupEntriesBySource(entries: ActivityEntry[]): GroupedEntries[] {
  const groupMap = new Map<string, ActivityEntry[]>();
  const groupOrder: string[] = [];

  for (const entry of entries) {
    const source = getEntrySource(entry);
    if (!groupMap.has(source)) {
      groupMap.set(source, []);
      groupOrder.push(source);
    }
    groupMap.get(source)!.push(entry);
  }

  return groupOrder.map((source) => ({
    source,
    entries: groupMap.get(source)!,
  }));
}

export function ActivityLog({ projectId }: ActivityLogProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('activityLog.collapsedSections');
      if (saved) {
        try {
          return new Set(JSON.parse(saved));
        } catch {
          return new Set();
        }
      }
    }
    return new Set();
  });
  const logRef = useRef<HTMLDivElement>(null);

  const toggleSection = useCallback((source: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      localStorage.setItem('activityLog.collapsedSections', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const groupedEntries = groupEntriesBySource(entries);

  const clearLog = async () => {
    setIsClearing(true);
    try {
      const res = await fetch(`/api/orchestrator/log/clear?projectId=${projectId}`, {
        method: 'POST',
      });
      if (res.ok) {
        setEntries([]);
      }
    } catch (err) {
      console.error('Failed to clear activity log:', err);
    } finally {
      setIsClearing(false);
    }
  };

  const fetchLog = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/activity?projectId=${projectId}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch (err) {
      console.error('Failed to fetch activity log:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Poll for updates
  useEffect(() => {
    fetchLog();
    const interval = setInterval(fetchLog, 3000);
    return () => clearInterval(interval);
  }, [projectId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="h-full flex flex-col bg-zinc-100 dark:bg-zinc-900 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-200 dark:bg-zinc-800">
        <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
          <Activity size={16} />
          <span className="text-sm font-semibold">Activity</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearLog}
            disabled={isClearing || entries.length === 0}
            className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-full transition-colors disabled:opacity-50"
            title="Clear log"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={fetchLog}
            disabled={isLoading}
            className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-full transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div
        ref={logRef}
        className="flex-1 overflow-y-auto p-3 space-y-3"
      >
        {entries.length === 0 ? (
          <div className="text-zinc-500 text-center py-8 text-sm">No activity yet</div>
        ) : (
          groupedEntries.map((group) => {
            const isCollapsed = collapsedSections.has(group.source);

            return (
              <div key={group.source} className="bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl overflow-hidden">
                <button
                  onClick={() => toggleSection(group.source)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-zinc-300/50 dark:hover:bg-zinc-700/50 transition-colors"
                >
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </span>
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {group.source}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-300 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400">
                    {group.entries.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="px-3 pb-3 space-y-2">
                    {group.entries.map((entry) => {
                      const kind = getActivityKind(entry);
                      const colors = getActivityColors(kind);

                      return (
                        <div
                          key={entry.id}
                          className={`flex items-start gap-3 px-4 py-3 rounded-2xl text-sm ${colors.bg} shadow-sm`}
                        >
                          <div className={`flex-shrink-0 mt-0.5 p-1.5 rounded-full bg-white/50 dark:bg-black/20 ${colors.icon}`}>
                            {getActivityIcon(kind)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-zinc-700 dark:text-zinc-200 break-words leading-relaxed">
                              {entry.summary}
                            </div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                              {formatTime(entry.timestamp)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Backward compatibility export
export { ActivityLog as OrchestratorLog };
