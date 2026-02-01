import { useState, useEffect } from 'react';
import { Activity, Clock, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface AgentHealth {
  id: string;
  name: string;
  branch: string;
  status: 'active' | 'idle' | 'error' | 'merged';
  hasSession: boolean;
  lastActivity?: string;
  commitsAhead: number;
  modifiedFiles: number;
}

interface AgentHealthDashboardProps {
  projectId: string;
}

export function AgentHealthDashboard({ projectId }: AgentHealthDashboardProps) {
  const [agents, setAgents] = useState<AgentHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAgentHealth = async () => {
      try {
        const res = await fetch(`/api/worktrees?projectId=${projectId}`);
        if (res.ok) {
          const worktrees = await res.json();
          const healthData: AgentHealth[] = worktrees
            .filter((w: any) => w.branch !== 'master' && w.branch !== 'main')
            .map((w: any) => ({
              id: w.id,
              name: w.branch.replace('feature/', ''),
              branch: w.branch,
              status: w.status?.toLowerCase() || 'idle',
              hasSession: w.hasSession || false,
              lastActivity: w.lastCommitDate,
              commitsAhead: w.commitsAhead || 0,
              modifiedFiles: w.modifiedFiles || 0,
            }));
          setAgents(healthData);
        }
      } catch (error) {
        console.error('Failed to fetch agent health:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAgentHealth();
    const interval = setInterval(fetchAgentHealth, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  const getStatusIcon = (status: string, hasSession: boolean) => {
    if (hasSession) {
      return <Loader2 size={14} className="text-blue-400 animate-spin" />;
    }
    switch (status) {
      case 'active':
        return <Activity size={14} className="text-green-400" />;
      case 'merged':
        return <CheckCircle size={14} className="text-purple-400" />;
      case 'error':
        return <AlertCircle size={14} className="text-red-400" />;
      default:
        return <Clock size={14} className="text-zinc-400" />;
    }
  };

  const getStatusColor = (status: string, hasSession: boolean) => {
    if (hasSession) return 'border-blue-500/50 bg-blue-500/10';
    switch (status) {
      case 'active':
        return 'border-green-500/50 bg-green-500/10';
      case 'merged':
        return 'border-purple-500/50 bg-purple-500/10';
      case 'error':
        return 'border-red-500/50 bg-red-500/10';
      default:
        return 'border-zinc-600 bg-zinc-800/50';
    }
  };

  const formatTimeAgo = (dateString?: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-zinc-400" />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="p-4 text-center text-zinc-500 text-sm">
        No agents active
      </div>
    );
  }

  return (
    <div className="p-2 space-y-2">
      <div className="text-xs font-medium text-zinc-400 uppercase tracking-wide px-2 mb-2">
        Agent Health ({agents.length})
      </div>
      {agents.slice(0, 10).map((agent) => (
        <div
          key={agent.id}
          className={`p-2 rounded-lg border ${getStatusColor(agent.status, agent.hasSession)} transition-colors`}
        >
          <div className="flex items-center gap-2">
            {getStatusIcon(agent.status, agent.hasSession)}
            <span className="text-sm font-medium text-zinc-200 truncate flex-1">
              {agent.name}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
            <span>{formatTimeAgo(agent.lastActivity)}</span>
            {agent.commitsAhead > 0 && (
              <span className="text-green-400">+{agent.commitsAhead} commits</span>
            )}
            {agent.modifiedFiles > 0 && (
              <span className="text-yellow-400">{agent.modifiedFiles} modified</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
