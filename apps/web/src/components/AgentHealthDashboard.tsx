import { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Cpu,
  Heart,
  Loader2,
  PauseCircle,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { useProjectStore, type Worktree } from '../stores/project.store';
import { useTerminalStore, type TerminalSession } from '../stores/terminal.store';

interface AgentHealth {
  worktree: Worktree;
  session: TerminalSession | null;
  status: 'healthy' | 'working' | 'idle' | 'rate-limited' | 'offline';
  lastActivity: number | null;
}

interface HealthStats {
  total: number;
  healthy: number;
  working: number;
  idle: number;
  rateLimited: number;
  offline: number;
}

export function AgentHealthDashboard() {
  const { worktrees, activeProjectId } = useProjectStore();
  const { sessions } = useTerminalStore();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter worktrees for the active project that aren't archived
  const projectWorktrees = useMemo(
    () => worktrees.filter((w) => w.projectId === activeProjectId && !w.archived && !w.isMain),
    [worktrees, activeProjectId]
  );

  // Calculate agent health for each worktree
  const agentHealthList: AgentHealth[] = useMemo(() => {
    return projectWorktrees.map((worktree) => {
      const worktreeSessions = Array.from(sessions.values()).filter(
        (s) => s.worktreeId === worktree.id
      );
      const activeSession = worktreeSessions.find((s) => s.isConnected);

      let status: AgentHealth['status'] = 'offline';
      if (activeSession) {
        if (activeSession.rateLimit?.isLimited) {
          status = 'rate-limited';
        } else if (activeSession.activityStatus === 'running') {
          status = 'working';
        } else if (activeSession.activityStatus === 'waiting') {
          status = 'idle';
        } else {
          status = 'healthy';
        }
      }

      return {
        worktree,
        session: activeSession || null,
        status,
        lastActivity: activeSession?.lastOutputAt || null,
      };
    });
  }, [projectWorktrees, sessions]);

  // Calculate stats
  const stats: HealthStats = useMemo(() => {
    const initial: HealthStats = {
      total: agentHealthList.length,
      healthy: 0,
      working: 0,
      idle: 0,
      rateLimited: 0,
      offline: 0,
    };

    return agentHealthList.reduce((acc, agent) => {
      acc[agent.status === 'rate-limited' ? 'rateLimited' : agent.status]++;
      return acc;
    }, initial);
  }, [agentHealthList]);

  // Auto-refresh data
  useEffect(() => {
    const interval = setInterval(() => {
      // The stores auto-update from WebSocket, this just forces a re-render
      setIsRefreshing(true);
      setTimeout(() => setIsRefreshing(false), 300);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 300);
  };

  const getStatusIcon = (status: AgentHealth['status']) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 size={14} className="text-green-500" />;
      case 'working':
        return <Loader2 size={14} className="text-pink-500 animate-spin" />;
      case 'idle':
        return <Clock size={14} className="text-amber-500" />;
      case 'rate-limited':
        return <PauseCircle size={14} className="text-orange-500" />;
      case 'offline':
        return <AlertCircle size={14} className="text-zinc-400" />;
    }
  };

  const getStatusLabel = (status: AgentHealth['status']) => {
    switch (status) {
      case 'healthy':
        return 'Connected';
      case 'working':
        return 'Working';
      case 'idle':
        return 'Waiting';
      case 'rate-limited':
        return 'Paused';
      case 'offline':
        return 'Offline';
    }
  };

  const getStatusColor = (status: AgentHealth['status']) => {
    switch (status) {
      case 'healthy':
        return 'text-green-500';
      case 'working':
        return 'text-pink-500';
      case 'idle':
        return 'text-amber-500';
      case 'rate-limited':
        return 'text-orange-500';
      case 'offline':
        return 'text-zinc-400';
    }
  };

  const formatLastActivity = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 10) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  // Calculate overall health percentage
  const healthPercentage = useMemo(() => {
    if (stats.total === 0) return 100;
    const active = stats.healthy + stats.working + stats.idle;
    return Math.round((active / stats.total) * 100);
  }, [stats]);

  const getHealthColor = (percentage: number) => {
    if (percentage >= 80) return 'text-green-500';
    if (percentage >= 50) return 'text-amber-500';
    return 'text-red-500';
  };

  if (!activeProjectId) {
    return (
      <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6">
        <div className="text-center text-zinc-500">
          <Heart size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">Select a project to view agent health</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-green-500" />
          <h3 className="text-sm font-medium">Agent Health</h3>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Heart size={12} className={getHealthColor(healthPercentage)} />
            <span className={`text-xs font-medium ${getHealthColor(healthPercentage)}`}>
              {healthPercentage}%
            </span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        <div className="text-center p-2 bg-zinc-50 dark:bg-zinc-900 rounded">
          <Cpu size={14} className="mx-auto text-zinc-500 mb-1" />
          <div className="text-lg font-semibold">{stats.total}</div>
          <div className="text-xs text-zinc-500">Total</div>
        </div>
        <div className="text-center p-2 bg-zinc-50 dark:bg-zinc-900 rounded">
          <Zap size={14} className="mx-auto text-pink-500 mb-1" />
          <div className="text-lg font-semibold text-pink-500">{stats.working}</div>
          <div className="text-xs text-zinc-500">Working</div>
        </div>
        <div className="text-center p-2 bg-zinc-50 dark:bg-zinc-900 rounded">
          <CheckCircle2 size={14} className="mx-auto text-green-500 mb-1" />
          <div className="text-lg font-semibold text-green-500">{stats.healthy + stats.idle}</div>
          <div className="text-xs text-zinc-500">Ready</div>
        </div>
        <div className="text-center p-2 bg-zinc-50 dark:bg-zinc-900 rounded">
          <PauseCircle size={14} className="mx-auto text-orange-500 mb-1" />
          <div className="text-lg font-semibold text-orange-500">{stats.rateLimited}</div>
          <div className="text-xs text-zinc-500">Paused</div>
        </div>
        <div className="text-center p-2 bg-zinc-50 dark:bg-zinc-900 rounded">
          <AlertCircle size={14} className="mx-auto text-zinc-400 mb-1" />
          <div className="text-lg font-semibold text-zinc-400">{stats.offline}</div>
          <div className="text-xs text-zinc-500">Offline</div>
        </div>
      </div>

      {/* Agent List */}
      <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
        {agentHealthList.length === 0 ? (
          <div className="text-zinc-500 text-sm text-center py-4">
            No active agents
          </div>
        ) : (
          agentHealthList.map((agent) => (
            <div
              key={agent.worktree.id}
              className="flex items-center justify-between p-2.5 bg-zinc-50 dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-700"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {getStatusIcon(agent.status)}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{agent.worktree.branch}</div>
                  <div className="text-xs text-zinc-500 truncate">
                    {agent.session?.name || 'No session'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs flex-shrink-0">
                <span className={getStatusColor(agent.status)}>{getStatusLabel(agent.status)}</span>
                <span className="text-zinc-500">{formatLastActivity(agent.lastActivity)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Rate Limit Warning */}
      {stats.rateLimited > 0 && (
        <div className="mt-3 p-2 bg-orange-500/10 border border-orange-500/30 rounded text-xs text-orange-500 flex items-center gap-2">
          <PauseCircle size={12} />
          <span>
            {stats.rateLimited} agent{stats.rateLimited > 1 ? 's' : ''} rate limited. They will
            resume automatically.
          </span>
        </div>
      )}
    </div>
  );
}
