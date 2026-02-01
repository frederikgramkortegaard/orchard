import { useState, useEffect } from 'react';
import { Bot, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface AgentActivityCardProps {
  projectId: string;
}

interface AgentActivity {
  timestamp: string;
  type: 'start' | 'complete' | 'error' | 'action';
  message: string;
  agent?: string;
}

export function AgentActivityCard({ projectId }: AgentActivityCardProps) {
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [stats, setStats] = useState({ total: 0, completed: 0, errors: 0 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchActivity = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/orchestrator/log?projectId=${projectId}&lines=50`);
        if (res.ok) {
          const data = await res.json();
          const lines: string[] = data.lines || [];

          const parsed: AgentActivity[] = lines
            .map((line: string) => {
              const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
              if (!match) return null;

              const [, timestamp, message] = match;
              let type: AgentActivity['type'] = 'action';
              if (message.includes('ERROR') || message.includes('FAILED')) type = 'error';
              else if (message.includes('COMPLETE') || message.includes('SUCCESS')) type = 'complete';
              else if (message.includes('START') || message.includes('SPAWN')) type = 'start';

              return { timestamp, type, message };
            })
            .filter(Boolean) as AgentActivity[];

          setActivities(parsed.slice(-10).reverse());
          setStats({
            total: parsed.length,
            completed: parsed.filter((a) => a.type === 'complete').length,
            errors: parsed.filter((a) => a.type === 'error').length,
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

  const getTypeIcon = (type: AgentActivity['type']) => {
    switch (type) {
      case 'start':
        return <Zap size={12} className="text-blue-500" />;
      case 'complete':
        return <CheckCircle2 size={12} className="text-emerald-500" />;
      case 'error':
        return <AlertTriangle size={12} className="text-red-500" />;
      default:
        return <Bot size={12} className="text-zinc-400" />;
    }
  };

  const formatTime = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return timestamp;
    }
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
          <span className="text-emerald-500">{stats.completed} done</span>
          {stats.errors > 0 && <span className="text-red-500">{stats.errors} errors</span>}
        </div>
      </div>

      <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
        {isLoading ? (
          <div className="text-zinc-500 text-sm text-center py-4">Loading...</div>
        ) : activities.length === 0 ? (
          <div className="text-zinc-500 text-sm text-center py-4">No agent activity</div>
        ) : (
          activities.map((activity, i) => (
            <div
              key={i}
              className="flex items-start gap-2 p-2 bg-zinc-50 dark:bg-zinc-900 rounded text-xs"
            >
              <div className="mt-0.5">{getTypeIcon(activity.type)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-zinc-700 dark:text-zinc-300 truncate">{activity.message}</p>
              </div>
              <span className="text-zinc-500 flex-shrink-0">{formatTime(activity.timestamp)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
