import { useState, useEffect, useRef } from 'react';
import { Terminal, RefreshCw, Trash2, Bot, Cpu } from 'lucide-react';

interface OrchestratorLogProps {
  projectId: string;
}

interface Activity {
  id: number;
  timestamp: string;
  type: string;
  category: string;
  summary: string;
  agentName: string | null;
  worktreeId: string | null;
  details: Record<string, unknown>;
}

export function OrchestratorLog({ projectId }: OrchestratorLogProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
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
        setActivities([]);
      }
    } catch (err) {
      console.error('Failed to clear orchestrator log:', err);
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
        // Reverse to show oldest first (chronological order)
        setActivities((data.activities || []).reverse());
      }
    } catch (err) {
      console.error('Failed to fetch orchestrator log:', err);
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
  }, [activities]);

  const formatTime = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleTimeString();
    } catch {
      return timestamp;
    }
  };

  const formatSummary = (activity: Activity) => {
    // Remove agent name prefix if present (we show it separately)
    let summary = activity.summary;
    if (activity.agentName && summary.startsWith(`[${activity.agentName}]`)) {
      summary = summary.slice(activity.agentName.length + 3).trim();
    }
    return summary;
  };

  const getMessageColor = (activity: Activity) => {
    const summary = activity.summary.toLowerCase();
    if (activity.type === 'error' || summary.includes('error')) return 'text-red-600 dark:text-red-400';
    if (summary.includes('complete') || summary.includes('success')) return 'text-green-600 dark:text-green-400';
    return '';
  };

  const getCategoryIcon = (category: string) => {
    if (category === 'agent') return <Bot size={10} className="text-amber-500" />;
    if (category === 'orchestrator') return <Cpu size={10} className="text-blue-500" />;
    return null;
  };

  return (
    <div className="h-full flex flex-col bg-zinc-200 dark:bg-zinc-900 rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-300 dark:border-zinc-700">
        <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
          <Terminal size={14} />
          <span className="text-xs font-medium">All Activity</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearLog}
            disabled={isClearing || activities.length === 0}
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
        className="flex-1 overflow-y-auto p-2 font-mono text-xs text-zinc-700 dark:text-zinc-300 space-y-0.5"
      >
        {activities.length === 0 ? (
          <div className="text-zinc-500 text-center py-4">No activity yet</div>
        ) : (
          activities.map((activity) => (
            <div key={activity.id} className="flex gap-2 items-start">
              <span className="text-zinc-500 flex-shrink-0">{formatTime(activity.timestamp)}</span>
              <span className="flex-shrink-0">{getCategoryIcon(activity.category)}</span>
              {activity.agentName && (
                <span className="px-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded text-[10px] font-medium flex-shrink-0">
                  {activity.agentName}
                </span>
              )}
              <span className={`break-words ${getMessageColor(activity)}`}>
                {formatSummary(activity)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
