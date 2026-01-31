import { useState, useEffect } from 'react';
import { Bot, Zap, AlertTriangle, CheckCircle2, MessageCircle, TrendingUp } from 'lucide-react';

interface AgentActivityCardProps {
  projectId: string;
}

interface Activity {
  id: number;
  timestamp: string;
  type: 'tick' | 'action' | 'event' | 'decision' | 'error' | 'llm_request' | 'llm_response';
  category: 'system' | 'orchestrator' | 'agent' | 'worktree' | 'user';
  summary: string;
  agentName: string | null;
  worktreeId: string | null;
  details: Record<string, unknown>;
}

type ActivityType = 'start' | 'complete' | 'error' | 'question' | 'progress' | 'action';

function getActivityType(activity: Activity): ActivityType {
  const summary = activity.summary.toLowerCase();
  if (activity.type === 'error' || summary.includes('error') || summary.includes('failed')) return 'error';
  if (summary.includes('complete') || summary.includes('success')) return 'complete';
  if (summary.includes('question')) return 'question';
  if (summary.includes('progress')) return 'progress';
  if (summary.includes('start') || summary.includes('spawn')) return 'start';
  return 'action';
}

export function AgentActivityCard({ projectId }: AgentActivityCardProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [stats, setStats] = useState({ total: 0, completed: 0, errors: 0, agents: 0 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchActivity = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/activity?projectId=${projectId}&limit=50`);
        if (res.ok) {
          const data = await res.json();
          const activityList: Activity[] = data.activities || [];

          // Get unique agent names
          const uniqueAgents = new Set(activityList.filter(a => a.agentName).map(a => a.agentName));

          setActivities(activityList.slice(0, 15));
          setStats({
            total: activityList.length,
            completed: activityList.filter(a => getActivityType(a) === 'complete').length,
            errors: activityList.filter(a => getActivityType(a) === 'error').length,
            agents: uniqueAgents.size,
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

  const getTypeIcon = (type: ActivityType) => {
    switch (type) {
      case 'start':
        return <Zap size={12} className="text-blue-500" />;
      case 'complete':
        return <CheckCircle2 size={12} className="text-green-500" />;
      case 'error':
        return <AlertTriangle size={12} className="text-red-500" />;
      case 'question':
        return <MessageCircle size={12} className="text-yellow-500" />;
      case 'progress':
        return <TrendingUp size={12} className="text-purple-500" />;
      default:
        return <Bot size={12} className="text-zinc-400" />;
    }
  };

  const getCategoryColor = (category: Activity['category']) => {
    switch (category) {
      case 'agent':
        return 'text-amber-600 dark:text-amber-400';
      case 'orchestrator':
        return 'text-blue-600 dark:text-blue-400';
      case 'system':
        return 'text-zinc-500';
      default:
        return 'text-zinc-500';
    }
  };

  const formatTime = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
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

  return (
    <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-amber-500" />
          <h3 className="text-sm font-medium">All Agent Activity</h3>
        </div>
        <div className="flex gap-3 text-xs">
          {stats.agents > 0 && <span className="text-amber-500">{stats.agents} agents</span>}
          <span className="text-zinc-500">{stats.total} actions</span>
          <span className="text-green-500">{stats.completed} done</span>
          {stats.errors > 0 && <span className="text-red-500">{stats.errors} errors</span>}
        </div>
      </div>

      <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
        {isLoading ? (
          <div className="text-zinc-500 text-sm text-center py-4">Loading...</div>
        ) : activities.length === 0 ? (
          <div className="text-zinc-500 text-sm text-center py-4">No agent activity</div>
        ) : (
          activities.map((activity) => {
            const activityType = getActivityType(activity);
            return (
              <div
                key={activity.id}
                className="flex items-start gap-2 p-2 bg-zinc-50 dark:bg-zinc-900 rounded text-xs"
              >
                <div className="mt-0.5">{getTypeIcon(activityType)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {activity.agentName && (
                      <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded text-[10px] font-medium">
                        {activity.agentName}
                      </span>
                    )}
                    {!activity.agentName && activity.category !== 'agent' && (
                      <span className={`text-[10px] font-medium ${getCategoryColor(activity.category)}`}>
                        {activity.category}
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-700 dark:text-zinc-300 break-words">
                    {formatSummary(activity)}
                  </p>
                </div>
                <span className="text-zinc-500 flex-shrink-0">{formatTime(activity.timestamp)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
