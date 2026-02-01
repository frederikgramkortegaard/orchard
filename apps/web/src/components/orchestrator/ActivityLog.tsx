import { useState, useEffect, useRef } from 'react';
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

export function ActivityLog({ projectId }: ActivityLogProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

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
    <div className="h-full flex flex-col bg-zinc-200 dark:bg-zinc-900 rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-300 dark:border-zinc-700">
        <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
          <Activity size={14} />
          <span className="text-xs font-medium">Activity</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearLog}
            disabled={isClearing || entries.length === 0}
            className="p-1 text-zinc-600 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 rounded disabled:opacity-50"
            title="Clear log"
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={fetchLog}
            disabled={isLoading}
            className="p-1 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div
        ref={logRef}
        className="flex-1 overflow-y-auto p-2 space-y-1"
      >
        {entries.length === 0 ? (
          <div className="text-zinc-500 text-center py-4 text-xs">No activity yet</div>
        ) : (
          entries.map((entry) => {
            const kind = getActivityKind(entry);
            const colors = getActivityColors(kind);
            const branch = extractAgentBranch(entry);

            return (
              <div
                key={entry.id}
                className={`flex items-start gap-2 p-1.5 rounded text-xs ${colors.bg}`}
              >
                <div className={`flex-shrink-0 mt-0.5 ${colors.icon}`}>
                  {getActivityIcon(kind)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500 dark:text-zinc-500 flex-shrink-0">
                      {formatTime(entry.timestamp)}
                    </span>
                    {branch && entry.category === 'agent' && (
                      <span className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-[10px] font-medium">
                        {branch}
                      </span>
                    )}
                  </div>
                  <div className="text-zinc-700 dark:text-zinc-300 break-words">
                    {entry.summary}
                  </div>
                </div>
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
