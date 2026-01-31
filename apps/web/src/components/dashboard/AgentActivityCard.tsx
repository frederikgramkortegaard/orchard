import { useState, useEffect } from 'react';
import { Bot, Zap, AlertTriangle, CheckCircle2, HelpCircle, Loader2 } from 'lucide-react';

interface AgentActivityCardProps {
  projectId: string;
}

interface ActivityEntry {
  id: number;
  timestamp: string;
  activityType: 'progress' | 'completion' | 'error' | 'question' | 'event' | 'system';
  summary: string;
  agentName: string | null;
  details: {
    percentComplete?: number;
    currentStep?: string;
  };
}

export function AgentActivityCard({ projectId }: AgentActivityCardProps) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [stats, setStats] = useState({ total: 0, completed: 0, errors: 0 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchActivity = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/orchestrator/activity?projectId=${projectId}&limit=50&category=agent`);
        if (res.ok) {
          const data = await res.json();
          const entries: ActivityEntry[] = data.activities || [];

          // Get most recent 10 entries (they come in chronological order)
          const recent = entries.slice(-10).reverse();
          setActivities(recent);

          setStats({
            total: entries.length,
            completed: entries.filter((a) => a.activityType === 'completion').length,
            errors: entries.filter((a) => a.activityType === 'error').length,
          });
        }
      } catch (err) {
        console.error('Failed to fetch agent activity:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchActivity();
    const interval = setInterval(fetchActivity, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  const getTypeIcon = (activityType: ActivityEntry['activityType']) => {
    switch (activityType) {
      case 'progress':
        return <Loader2 size={12} className="text-blue-500" />;
      case 'completion':
        return <CheckCircle2 size={12} className="text-green-500" />;
      case 'error':
        return <AlertTriangle size={12} className="text-red-500" />;
      case 'question':
        return <HelpCircle size={12} className="text-amber-500" />;
      default:
        return <Zap size={12} className="text-zinc-400" />;
    }
  };

  const formatTime = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return timestamp;
    }
  };

  const formatSummary = (entry: ActivityEntry) => {
    let summary = entry.summary;
    // Remove redundant prefixes
    summary = summary.replace(/^Agent\s+(progress|completed|error|question|blocker|warning):\s*/i, '');
    return summary;
  };

  return (
    <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-amber-500" />
          <h3 className="text-sm font-medium">Agent Activity</h3>
        </div>
        <div className="flex gap-3 text-xs">
          <span className="text-zinc-500">{stats.total} actions</span>
          <span className="text-green-500">{stats.completed} done</span>
          {stats.errors > 0 && <span className="text-red-500">{stats.errors} errors</span>}
        </div>
      </div>

      <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
        {isLoading ? (
          <div className="text-zinc-500 text-sm text-center py-4">Loading...</div>
        ) : activities.length === 0 ? (
          <div className="text-zinc-500 text-sm text-center py-4">No agent activity</div>
        ) : (
          activities.map((activity) => (
            <div
              key={activity.id}
              className="flex items-start gap-2 p-2 bg-zinc-50 dark:bg-zinc-900 rounded text-xs"
            >
              <div className="mt-0.5">{getTypeIcon(activity.activityType)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {activity.agentName && (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      {activity.agentName.replace(/^feature\//, '')}:
                    </span>
                  )}
                  <span className="text-zinc-700 dark:text-zinc-300 truncate">
                    {formatSummary(activity)}
                  </span>
                </div>
                {activity.activityType === 'progress' && activity.details.percentComplete !== undefined && (
                  <div className="mt-1 flex items-center gap-1">
                    <div className="flex-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded overflow-hidden max-w-[60px]">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${activity.details.percentComplete}%` }}
                      />
                    </div>
                    <span className="text-zinc-500 text-[10px]">{activity.details.percentComplete}%</span>
                  </div>
                )}
              </div>
              <span className="text-zinc-500 flex-shrink-0">{formatTime(activity.timestamp)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
