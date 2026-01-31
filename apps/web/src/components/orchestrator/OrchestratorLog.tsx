import { useState, useEffect, useRef } from 'react';
import {
  Activity,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Loader2,
  Bot,
  Cpu,
} from 'lucide-react';

interface OrchestratorLogProps {
  projectId: string;
}

interface ActivityEntry {
  id: number;
  timestamp: string;
  type: string;
  category: string;
  activityType: 'progress' | 'completion' | 'error' | 'question' | 'event' | 'system';
  summary: string;
  agentName: string | null;
  details: {
    status?: string;
    percentComplete?: number;
    currentStep?: string;
    severity?: string;
    context?: string;
    question?: string;
    options?: string[];
    suggestedAction?: string;
  };
}

export function OrchestratorLog({ projectId }: OrchestratorLogProps) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'agent'>('all');
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

  const fetchActivity = async () => {
    setIsLoading(true);
    try {
      const categoryParam = filter === 'agent' ? '&category=agent' : '';
      const res = await fetch(`/api/orchestrator/activity?projectId=${projectId}&limit=100${categoryParam}`);
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
    } catch (err) {
      console.error('Failed to fetch orchestrator activity:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Poll for updates
  useEffect(() => {
    fetchActivity();
    const interval = setInterval(fetchActivity, 3000);
    return () => clearInterval(interval);
  }, [projectId, filter]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [activities]);

  const getActivityIcon = (entry: ActivityEntry) => {
    switch (entry.activityType) {
      case 'completion':
        return <CheckCircle2 size={14} className="text-green-500" />;
      case 'error':
        return <AlertTriangle size={14} className="text-red-500" />;
      case 'question':
        return <HelpCircle size={14} className="text-amber-500" />;
      case 'progress':
        return <Loader2 size={14} className="text-blue-500" />;
      case 'system':
        return <Cpu size={14} className="text-zinc-400" />;
      default:
        return <Activity size={14} className="text-zinc-400" />;
    }
  };

  const getActivityColor = (entry: ActivityEntry) => {
    switch (entry.activityType) {
      case 'completion':
        return 'text-green-600 dark:text-green-400';
      case 'error':
        return 'text-red-600 dark:text-red-400';
      case 'question':
        return 'text-amber-600 dark:text-amber-400';
      case 'progress':
        return 'text-blue-600 dark:text-blue-400';
      default:
        return 'text-zinc-700 dark:text-zinc-300';
    }
  };

  const formatTime = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleTimeString('en', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  const formatSummary = (entry: ActivityEntry) => {
    // Remove redundant prefixes like "Agent progress:", "Agent completed:", etc.
    let summary = entry.summary;
    summary = summary.replace(/^Agent\s+(progress|completed|error|question|blocker|warning):\s*/i, '');
    return summary;
  };

  const agentActivities = activities.filter(a => a.category === 'agent');
  const displayedActivities = filter === 'agent' ? agentActivities : activities;

  return (
    <div className="h-full flex flex-col bg-zinc-200 dark:bg-zinc-900 rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-300 dark:border-zinc-700">
        <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
          <Activity size={14} />
          <span className="text-xs font-medium">Unified Activity</span>
          {agentActivities.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <Bot size={12} />
              {agentActivities.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | 'agent')}
            className="text-xs bg-zinc-200 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded px-1.5 py-0.5 text-zinc-700 dark:text-zinc-300"
          >
            <option value="all">All Activity</option>
            <option value="agent">Agent Only</option>
          </select>
          <button
            onClick={clearLog}
            disabled={isClearing || activities.length === 0}
            className="p-1 text-zinc-600 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 rounded disabled:opacity-50"
            title="Clear log"
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={fetchActivity}
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
        className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-1"
      >
        {displayedActivities.length === 0 ? (
          <div className="text-zinc-500 text-center py-4">No activity yet</div>
        ) : (
          displayedActivities.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2 p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 group"
            >
              <div className="flex-shrink-0 mt-0.5">
                {getActivityIcon(entry)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {entry.agentName && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                      <Bot size={10} />
                      {entry.agentName.replace(/^feature\//, '')}
                    </span>
                  )}
                  <span className={`${getActivityColor(entry)}`}>
                    {formatSummary(entry)}
                  </span>
                </div>
                {/* Show progress details */}
                {entry.activityType === 'progress' && entry.details.percentComplete !== undefined && (
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded overflow-hidden max-w-[100px]">
                      <div
                        className="h-full bg-blue-500 transition-all"
                        style={{ width: `${entry.details.percentComplete}%` }}
                      />
                    </div>
                    <span className="text-zinc-500 text-[10px]">{entry.details.percentComplete}%</span>
                  </div>
                )}
                {/* Show current step */}
                {entry.details.currentStep && (
                  <div className="text-zinc-500 text-[10px] mt-0.5">
                    Step: {entry.details.currentStep}
                  </div>
                )}
                {/* Show error context */}
                {entry.activityType === 'error' && entry.details.context && (
                  <div className="text-zinc-500 text-[10px] mt-0.5 truncate">
                    Context: {entry.details.context}
                  </div>
                )}
                {/* Show suggested action */}
                {entry.details.suggestedAction && (
                  <div className="text-zinc-500 text-[10px] mt-0.5">
                    Suggested: {entry.details.suggestedAction}
                  </div>
                )}
              </div>
              <span className="text-zinc-500 text-[10px] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {formatTime(entry.timestamp)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
