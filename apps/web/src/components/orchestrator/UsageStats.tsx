import { useState, useEffect } from 'react';
import {
  BarChart3,
  RefreshCw,
  Bot,
  MessageSquare,
  Activity,
  CheckCircle2,
  XCircle,
  Archive,
  GitMerge,
  Cpu,
} from 'lucide-react';

interface UsageStatsProps {
  projectId: string;
}

interface UsageData {
  projectId: string;
  generatedAt: string;
  summary: {
    totalAgents: number;
    activeAgents: number;
    archivedAgents: number;
    mergedAgents: number;
    totalMessages: number;
    userMessages: number;
    orchestratorMessages: number;
    totalActivities: number;
    totalPrintSessions: number;
    completedPrintSessions: number;
    failedPrintSessions: number;
  };
  activityBreakdown: Array<{
    type: string;
    count: number;
  }>;
  categoryBreakdown: Array<{
    category: string;
    count: number;
  }>;
  recentActivity: Array<{
    date: string;
    count: number;
  }>;
  agentsByStatus: Array<{
    status: string;
    count: number;
  }>;
}

const TYPE_LABELS: Record<string, string> = {
  tick: 'Tick',
  action: 'Action',
  event: 'Event',
  decision: 'Decision',
  error: 'Error',
  llm_request: 'LLM Request',
  llm_response: 'LLM Response',
};

const CATEGORY_LABELS: Record<string, string> = {
  system: 'System',
  orchestrator: 'Orchestrator',
  agent: 'Agent',
  worktree: 'Worktree',
  user: 'User',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  disconnected: 'Disconnected',
  resumed: 'Resumed',
  terminated: 'Terminated',
};

function StatCard({ icon: Icon, label, value, subValue, color }: {
  icon: typeof Bot;
  label: string;
  value: number | string;
  subValue?: string;
  color: string;
}) {
  return (
    <div className="bg-zinc-200/50 dark:bg-zinc-700/50 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1.5 rounded-lg ${color}`}>
          <Icon size={14} />
        </div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      </div>
      <div className="text-xl font-bold text-zinc-800 dark:text-zinc-100">{value}</div>
      {subValue && (
        <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{subValue}</div>
      )}
    </div>
  );
}

function MiniBarChart({ data, maxValue }: { data: Array<{ date: string; count: number }>; maxValue: number }) {
  if (data.length === 0 || maxValue === 0) {
    return (
      <div className="flex items-end gap-0.5 h-12">
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="flex-1 bg-zinc-300 dark:bg-zinc-600 rounded-t h-1" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-end gap-0.5 h-12">
      {data.map((entry, i) => {
        const height = Math.max(4, (entry.count / maxValue) * 100);
        return (
          <div
            key={i}
            className="flex-1 bg-blue-500 dark:bg-blue-400 rounded-t transition-all hover:bg-blue-600 dark:hover:bg-blue-300"
            style={{ height: `${height}%` }}
            title={`${entry.date}: ${entry.count} activities`}
          />
        );
      })}
    </div>
  );
}

function BreakdownList({ items, labels, emptyMessage }: {
  items: Array<{ key: string; count: number }>;
  labels: Record<string, string>;
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return <div className="text-xs text-zinc-500 dark:text-zinc-400 py-2">{emptyMessage}</div>;
  }

  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="space-y-1.5">
      {items.map((item) => {
        const percentage = total > 0 ? (item.count / total) * 100 : 0;
        return (
          <div key={item.key} className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-zinc-700 dark:text-zinc-300 truncate">
                  {labels[item.key] || item.key}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400 flex-shrink-0 ml-2">
                  {item.count}
                </span>
              </div>
              <div className="h-1.5 bg-zinc-300 dark:bg-zinc-600 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function UsageStats({ projectId }: UsageStatsProps) {
  const [data, setData] = useState<UsageData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/usage?days=14`);
      if (!res.ok) {
        throw new Error('Failed to fetch usage stats');
      }
      const stats = await res.json();
      setData(stats);
    } catch (err) {
      console.error('Failed to fetch usage stats:', err);
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setIsLoading(false);
    }
  };

  // Initial fetch and polling
  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000); // Poll every 30 seconds
    return () => clearInterval(interval);
  }, [projectId]);

  const maxActivityValue = data?.recentActivity.reduce((max, entry) => Math.max(max, entry.count), 0) || 0;

  return (
    <div className="h-full flex flex-col bg-zinc-100 dark:bg-zinc-900 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-200 dark:bg-zinc-800">
        <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
          <BarChart3 size={16} />
          <span className="text-sm font-semibold">AI Usage</span>
        </div>
        <button
          onClick={fetchStats}
          disabled={isLoading}
          className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-full transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {error ? (
          <div className="text-red-500 dark:text-red-400 text-center py-8 text-sm">
            {error}
          </div>
        ) : !data ? (
          <div className="text-zinc-500 text-center py-8 text-sm">
            Loading stats...
          </div>
        ) : (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                icon={Bot}
                label="Total Agents"
                value={data.summary.totalAgents}
                subValue={`${data.summary.activeAgents} active`}
                color="bg-blue-100 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400"
              />
              <StatCard
                icon={MessageSquare}
                label="Messages"
                value={data.summary.totalMessages}
                subValue={`${data.summary.userMessages} sent, ${data.summary.orchestratorMessages} received`}
                color="bg-purple-100 dark:bg-purple-900/30 text-purple-500 dark:text-purple-400"
              />
              <StatCard
                icon={Activity}
                label="Activities"
                value={data.summary.totalActivities}
                color="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500 dark:text-emerald-400"
              />
              <StatCard
                icon={Cpu}
                label="Tasks Run"
                value={data.summary.totalPrintSessions}
                subValue={data.summary.failedPrintSessions > 0
                  ? `${data.summary.completedPrintSessions} done, ${data.summary.failedPrintSessions} failed`
                  : `${data.summary.completedPrintSessions} completed`
                }
                color="bg-orange-100 dark:bg-orange-900/30 text-orange-500 dark:text-orange-400"
              />
            </div>

            {/* Agent Status Breakdown */}
            <div className="bg-zinc-200/50 dark:bg-zinc-800/50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <Bot size={14} className="text-zinc-500 dark:text-zinc-400" />
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Agent Status</span>
              </div>
              <div className="flex gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {data.summary.activeAgents} Active
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <GitMerge size={12} className="text-blue-500" />
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {data.summary.mergedAgents} Merged
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Archive size={12} className="text-zinc-400" />
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {data.summary.archivedAgents} Archived
                  </span>
                </div>
              </div>
            </div>

            {/* Activity Over Time */}
            <div className="bg-zinc-200/50 dark:bg-zinc-800/50 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Activity (Last 14 Days)
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {data.recentActivity.reduce((sum, d) => sum + d.count, 0)} total
                </span>
              </div>
              <MiniBarChart data={data.recentActivity} maxValue={maxActivityValue} />
            </div>

            {/* Activity by Type */}
            <div className="bg-zinc-200/50 dark:bg-zinc-800/50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <Activity size={14} className="text-zinc-500 dark:text-zinc-400" />
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Activity by Type
                </span>
              </div>
              <BreakdownList
                items={data.activityBreakdown.map(item => ({ key: item.type, count: item.count }))}
                labels={TYPE_LABELS}
                emptyMessage="No activity recorded"
              />
            </div>

            {/* Activity by Category */}
            <div className="bg-zinc-200/50 dark:bg-zinc-800/50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <Cpu size={14} className="text-zinc-500 dark:text-zinc-400" />
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Activity by Source
                </span>
              </div>
              <BreakdownList
                items={data.categoryBreakdown.map(item => ({ key: item.category, count: item.count }))}
                labels={CATEGORY_LABELS}
                emptyMessage="No activity recorded"
              />
            </div>

            {/* Session Status */}
            {data.agentsByStatus.length > 0 && (
              <div className="bg-zinc-200/50 dark:bg-zinc-800/50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={14} className="text-zinc-500 dark:text-zinc-400" />
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Session Status
                  </span>
                </div>
                <BreakdownList
                  items={data.agentsByStatus.map(item => ({ key: item.status, count: item.count }))}
                  labels={STATUS_LABELS}
                  emptyMessage="No sessions recorded"
                />
              </div>
            )}

            {/* Last Updated */}
            <div className="text-center text-xs text-zinc-400 dark:text-zinc-500 pt-2">
              Updated {new Date(data.generatedAt).toLocaleTimeString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
