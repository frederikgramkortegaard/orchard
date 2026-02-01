import { useState, useEffect, useCallback } from 'react';
import {
  Eye,
  GitMerge,
  MessageSquare,
  Pause,
  Loader2,
  AlertCircle,
  CheckCircle,
  Coffee,
} from 'lucide-react';

interface OrchestratorStatusProps {
  projectId: string;
}

interface LoopStatus {
  state: 'STOPPED' | 'STARTING' | 'RUNNING' | 'PAUSED' | 'DEGRADED' | 'STOPPING';
  tickNumber: number;
  lastTickAt: string | null;
  consecutiveFailures: number;
}

interface HealthSummary {
  totalWorktrees: number;
  activeWorktrees: number;
  mergedWorktrees: number;
  worktreesWithChanges: number;
}

interface HealthResponse {
  summary: HealthSummary;
  activeSessions: Array<{ worktreeId: string; branch: string }>;
  suggestedActions: Array<{ type: string; branch: string }>;
}

interface ActivityStatus {
  icon: React.ReactNode;
  text: string;
  color: string;
  bgColor: string;
  pulse?: boolean;
}

function determineActivity(
  loopStatus: LoopStatus | null,
  health: HealthResponse | null,
  pendingCount: number
): ActivityStatus {
  // Not running
  if (!loopStatus || loopStatus.state === 'STOPPED') {
    return {
      icon: <Pause size={12} />,
      text: 'Paused',
      color: 'text-zinc-500 dark:text-zinc-400',
      bgColor: 'bg-zinc-100 dark:bg-zinc-800',
    };
  }

  // Starting/Stopping
  if (loopStatus.state === 'STARTING' || loopStatus.state === 'STOPPING') {
    return {
      icon: <Loader2 size={12} className="animate-spin" />,
      text: loopStatus.state === 'STARTING' ? 'Starting...' : 'Stopping...',
      color: 'text-blue-500 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
      pulse: true,
    };
  }

  // Degraded state
  if (loopStatus.state === 'DEGRADED') {
    return {
      icon: <AlertCircle size={12} />,
      text: `💔 Degraded (${loopStatus.consecutiveFailures} failures) 💔`,
      color: 'text-amber-500 dark:text-amber-400',
      bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    };
  }

  // Paused
  if (loopStatus.state === 'PAUSED') {
    return {
      icon: <Pause size={12} />,
      text: 'Paused',
      color: 'text-zinc-500 dark:text-zinc-400',
      bgColor: 'bg-zinc-100 dark:bg-zinc-800',
    };
  }

  // Running - determine what it's doing
  if (pendingCount > 0) {
    return {
      icon: <MessageSquare size={12} />,
      text: `Processing ${pendingCount} message${pendingCount > 1 ? 's' : ''}`,
      color: 'text-blue-500 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
      pulse: true,
    };
  }

  if (health) {
    // Check for merge actions
    const mergeAction = health.suggestedActions?.find(a => a.type === 'archive' || a.type === 'review');
    if (mergeAction) {
      return {
        icon: <GitMerge size={12} />,
        text: `Ready to merge ${mergeAction.branch}`,
        color: 'text-purple-500 dark:text-purple-400',
        bgColor: 'bg-purple-50 dark:bg-purple-900/20',
      };
    }

    // Monitoring active agents
    const activeCount = health.activeSessions?.length || 0;
    if (activeCount > 0) {
      return {
        icon: <Eye size={12} />,
        text: `Monitoring ${activeCount} agent${activeCount > 1 ? 's' : ''}`,
        color: 'text-green-500 dark:text-green-400',
        bgColor: 'bg-green-50 dark:bg-green-900/20',
      };
    }

    // Has worktrees with changes
    if (health.summary?.worktreesWithChanges > 0) {
      return {
        icon: <CheckCircle size={12} />,
        text: `${health.summary.worktreesWithChanges} worktree${health.summary.worktreesWithChanges > 1 ? 's' : ''} with changes`,
        color: 'text-cyan-500 dark:text-cyan-400',
        bgColor: 'bg-cyan-50 dark:bg-cyan-900/20',
      };
    }
  }

  // Idle
  return {
    icon: <Coffee size={12} />,
    text: 'Idle',
    color: 'text-zinc-400 dark:text-zinc-500',
    bgColor: 'bg-zinc-50 dark:bg-zinc-800/50',
  };
}

export function OrchestratorStatus({ projectId }: OrchestratorStatusProps) {
  const [loopStatus, setLoopStatus] = useState<LoopStatus | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const fetchStatus = useCallback(async () => {
    try {
      const [loopRes, healthRes, pendingRes] = await Promise.all([
        fetch('/api/orchestrator/loop/status'),
        fetch(`/api/orchestrator/${projectId}/health`),
        fetch('/api/orchestrator/loop/pending-count'),
      ]);

      if (loopRes.ok) {
        setLoopStatus(await loopRes.json());
      }
      if (healthRes.ok) {
        setHealth(await healthRes.json());
      }
      if (pendingRes.ok) {
        const data = await pendingRes.json();
        setPendingCount(data.count || 0);
      }
    } catch {
      // Ignore errors during polling
    }
  }, [projectId]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const activity = determineActivity(loopStatus, health, pendingCount);

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${activity.bgColor} ${activity.color} transition-all duration-300`}
      title={`Tick #${loopStatus?.tickNumber || 0}${loopStatus?.lastTickAt ? ` | Last: ${new Date(loopStatus.lastTickAt).toLocaleTimeString()}` : ''}`}
    >
      <span className={activity.pulse ? 'animate-pulse' : ''}>
        {activity.icon}
      </span>
      <span className="font-medium">{activity.text}</span>
    </div>
  );
}
