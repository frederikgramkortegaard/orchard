import { useState, useEffect, useCallback } from 'react';
import { Play, Square, Loader2, ChevronDown } from 'lucide-react';

interface LoopStatus {
  state: 'STOPPED' | 'STARTING' | 'RUNNING' | 'PAUSED' | 'DEGRADED' | 'STOPPING';
  tickNumber: number;
  config: {
    model: string;
  };
}

interface OllamaModel {
  name: string;
}

interface LoopStatusBadgeProps {
  projectId: string;
}

export function LoopStatusBadge({ projectId }: LoopStatusBadgeProps) {
  const [status, setStatus] = useState<LoopStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/orchestrator/loop/status');
      if (res.ok) setStatus(await res.json());
    } catch {}
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/api/orchestrator/loop/models');
      if (res.ok) {
        const data = await res.json();
        setModels(data.models || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchModels();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchModels]);

  const handleStart = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/orchestrator/loop/start?projectId=${encodeURIComponent(projectId)}`, { method: 'POST' });
      if (res.ok) setStatus(await res.json());
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/orchestrator/loop/stop', { method: 'POST' });
      if (res.ok) setStatus(await res.json());
    } finally {
      setIsLoading(false);
    }
  };

  const handleModelChange = async (model: string) => {
    setShowDropdown(false);
    try {
      const res = await fetch('/api/orchestrator/loop/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  const isRunning = status?.state === 'RUNNING' || status?.state === 'DEGRADED';
  const isStopped = status?.state === 'STOPPED';

  const stateColor = {
    RUNNING: 'bg-green-500',
    DEGRADED: 'bg-amber-500',
    PAUSED: 'bg-yellow-500',
    STARTING: 'bg-blue-500 animate-pulse',
    STOPPING: 'bg-blue-500 animate-pulse',
    STOPPED: 'bg-zinc-400',
  }[status?.state || 'STOPPED'];

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-zinc-200/50 dark:bg-zinc-700/50">
      {/* Status dot */}
      <div className={`w-2 h-2 rounded-full ${stateColor}`} title={status?.state || 'Unknown'} />

      {/* Model selector */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          <span className="max-w-[100px] truncate">{status?.config.model || 'No model'}</span>
          <ChevronDown size={12} />
        </button>
        {showDropdown && models.length > 0 && (
          <div className="absolute right-0 top-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded shadow-lg z-50 min-w-[150px] max-h-[200px] overflow-y-auto">
            {models.map(model => (
              <button
                key={model.name}
                onClick={() => handleModelChange(model.name)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                  model.name === status?.config.model ? 'bg-zinc-100 dark:bg-zinc-700' : ''
                }`}
              >
                {model.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Play/Stop button */}
      {isRunning ? (
        <button
          onClick={handleStop}
          disabled={isLoading}
          className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50"
          title="Stop Loop"
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
        </button>
      ) : isStopped ? (
        <button
          onClick={handleStart}
          disabled={isLoading}
          className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-green-500 dark:hover:text-green-400 disabled:opacity-50"
          title="Start Loop"
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        </button>
      ) : (
        <Loader2 size={14} className="animate-spin text-zinc-400" />
      )}

      {/* Tick counter when running */}
      {isRunning && (
        <span className="text-xs text-zinc-500 dark:text-zinc-500">#{status?.tickNumber}</span>
      )}
    </div>
  );
}
