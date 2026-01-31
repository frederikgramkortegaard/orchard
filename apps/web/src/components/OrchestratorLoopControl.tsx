import { useState, useEffect, useCallback } from 'react';
import { Play, Square, RefreshCw, Loader2 } from 'lucide-react';

interface LoopStatus {
  state: 'STOPPED' | 'STARTING' | 'RUNNING' | 'PAUSED' | 'DEGRADED' | 'STOPPING';
  tickNumber: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  consecutiveFailures: number;
  config: {
    enabled: boolean;
    provider: string;
    model: string;
    tickIntervalMs: number;
  };
}

interface OrchestratorLoopControlProps {
  projectId: string;
}

export function OrchestratorLoopControl({ projectId }: OrchestratorLoopControlProps) {
  const [status, setStatus] = useState<LoopStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/orchestrator/loop/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setError(null);
      }
    } catch {
      // Ignore fetch errors during polling
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleStart = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orchestrator/loop/start?projectId=${encodeURIComponent(projectId)}`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to start loop');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start loop');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/orchestrator/loop/stop', {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to stop loop');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to stop loop');
    } finally {
      setIsLoading(false);
    }
  };

  const isRunning = status?.state === 'RUNNING' || status?.state === 'DEGRADED';
  const isStopped = status?.state === 'STOPPED';
  const isTransitioning = status?.state === 'STARTING' || status?.state === 'STOPPING';

  const getStateColor = () => {
    switch (status?.state) {
      case 'RUNNING':
        return 'bg-green-500';
      case 'DEGRADED':
        return 'bg-amber-500';
      case 'PAUSED':
        return 'bg-yellow-500';
      case 'STARTING':
      case 'STOPPING':
        return 'bg-blue-500 animate-pulse';
      default:
        return 'bg-zinc-400';
    }
  };

  const formatTime = (isoString: string | null) => {
    if (!isoString) return '--';
    return new Date(isoString).toLocaleTimeString();
  };

  return (
    <div className="bg-zinc-200 dark:bg-zinc-800 rounded-lg border border-zinc-300 dark:border-zinc-700 p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${getStateColor()}`} />
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Loop: {status?.state || 'UNKNOWN'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isRunning && (
            <button
              onClick={handleStop}
              disabled={isLoading || isTransitioning}
              className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
              title="Stop Loop"
            >
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
            </button>
          )}
          {isStopped && (
            <button
              onClick={handleStart}
              disabled={isLoading || isTransitioning}
              className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-green-500 dark:hover:text-green-400 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
              title="Start Loop"
            >
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            </button>
          )}
          <button
            onClick={fetchStatus}
            className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded"
            title="Refresh Status"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Stats */}
      {status && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="text-zinc-500 dark:text-zinc-500">
            Tick #{status.tickNumber}
          </div>
          <div className="text-zinc-500 dark:text-zinc-500 text-right">
            {status.config.model}
          </div>
          <div className="text-zinc-500 dark:text-zinc-500">
            Last: {formatTime(status.lastTickAt)}
          </div>
          <div className="text-zinc-500 dark:text-zinc-500 text-right">
            {status.consecutiveFailures > 0 && (
              <span className="text-amber-500">
                {status.consecutiveFailures} failures
              </span>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-2 text-xs text-red-500 dark:text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
