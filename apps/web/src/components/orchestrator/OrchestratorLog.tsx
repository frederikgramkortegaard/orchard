import { useState, useEffect, useRef } from 'react';
import { Terminal, RefreshCw, Trash2 } from 'lucide-react';

interface OrchestratorLogProps {
  projectId: string;
}

export function OrchestratorLog({ projectId }: OrchestratorLogProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const clearLog = async () => {
    setIsClearing(true);
    try {
      const res = await fetch(`/api/orchestrator/log/clear?projectId=${projectId}`, {
        method: 'POST',
      });
      if (res.ok) {
        setLines([]);
      }
    } catch (err) {
      console.error('Failed to clear orchestrator log:', err);
    } finally {
      setIsClearing(false);
    }
  };

  const fetchLog = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/orchestrator/log?projectId=${projectId}&lines=100`);
      if (res.ok) {
        const data = await res.json();
        setLines(data.lines || []);
      }
    } catch (err) {
      console.error('Failed to fetch orchestrator log:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Poll for updates
  useEffect(() => {
    fetchLog();
    const interval = setInterval(fetchLog, 3000);
    return () => clearInterval(interval);
  }, [projectId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="h-full flex flex-col bg-zinc-200 dark:bg-zinc-900 rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-300 dark:border-zinc-700">
        <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
          <Terminal size={14} />
          <span className="text-xs font-medium">Orchestrator Activity</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearLog}
            disabled={isClearing || lines.length === 0}
            className="p-1 text-zinc-600 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 rounded disabled:opacity-50"
            title="Clear log"
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={fetchLog}
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
        className="flex-1 overflow-y-auto p-2 font-mono text-xs text-zinc-700 dark:text-zinc-300 space-y-0.5"
      >
        {lines.length === 0 ? (
          <div className="text-zinc-500 text-center py-4">No activity yet</div>
        ) : (
          lines.map((line, i) => {
            // Parse timestamp and message
            const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
            if (match) {
              const [, timestamp, message] = match;
              const time = new Date(timestamp).toLocaleTimeString();
              return (
                <div key={i} className="flex gap-2">
                  <span className="text-zinc-500 flex-shrink-0">{time}</span>
                  <span className={message.includes('ERROR') ? 'text-red-600 dark:text-red-400' : message.includes('COMPLETE') ? 'text-green-600 dark:text-green-400' : ''}>{message}</span>
                </div>
              );
            }
            return <div key={i}>{line}</div>;
          })
        )}
      </div>
    </div>
  );
}
