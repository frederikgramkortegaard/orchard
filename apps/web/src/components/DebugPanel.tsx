import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  RefreshCw,
  Trash2,
  Filter,
  Pause,
  Play,
  Server,
  Bot,
  Cpu,
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
} from 'lucide-react';

interface DebugPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DebugLogEntry {
  id: string;
  timestamp: string;
  source: 'server' | 'daemon' | 'orchestrator' | 'ai-api';
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

interface AIRequestLogEntry {
  id: string;
  timestamp: string;
  type: 'request' | 'response';
  tickNumber?: number;
  model?: string;
  provider?: string;
  messages?: Array<{ role: string; content: string }>;
  toolCalls?: Array<{ name: string; arguments: string }>;
  content?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  finishReason?: string;
  error?: string;
  durationMs?: number;
  correlationId?: string;
}

type SourceFilter = 'all' | 'server' | 'daemon' | 'orchestrator' | 'ai-api';
type TabType = 'logs' | 'ai-requests';

const SOURCE_COLORS: Record<DebugLogEntry['source'], { icon: string; bg: string; text: string }> = {
  server: {
    icon: 'text-pink-500 dark:text-pink-400',
    bg: 'bg-pink-100 dark:bg-pink-900/30',
    text: 'text-pink-700 dark:text-pink-300',
  },
  daemon: {
    icon: 'text-purple-500 dark:text-purple-400',
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    text: 'text-purple-700 dark:text-purple-300',
  },
  orchestrator: {
    icon: 'text-indigo-500 dark:text-indigo-400',
    bg: 'bg-indigo-100 dark:bg-indigo-900/30',
    text: 'text-indigo-700 dark:text-indigo-300',
  },
  'ai-api': {
    icon: 'text-green-500 dark:text-green-400',
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-300',
  },
};

const LEVEL_COLORS: Record<DebugLogEntry['level'], string> = {
  debug: 'text-zinc-500 dark:text-zinc-400',
  info: 'text-pink-500 dark:text-pink-400',
  warn: 'text-yellow-500 dark:text-yellow-400',
  error: 'text-red-500 dark:text-red-400',
};

function getSourceIcon(source: DebugLogEntry['source']) {
  switch (source) {
    case 'server':
      return <Server size={14} />;
    case 'daemon':
      return <Bot size={14} />;
    case 'orchestrator':
      return <Cpu size={14} />;
    case 'ai-api':
      return <Braces size={14} />;
    default:
      return <Server size={14} />;
  }
}

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  } catch {
    return timestamp;
  }
}

function ExpandableJSON({ data, maxLength = 200 }: { data: unknown; maxLength?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const jsonStr = JSON.stringify(data, null, 2);
  const isLong = jsonStr.length > maxLength;

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <pre className={`text-xs font-mono bg-zinc-900 text-zinc-300 p-2 rounded overflow-x-auto whitespace-pre-wrap ${!expanded && isLong ? 'max-h-24' : ''}`}>
        {expanded || !isLong ? jsonStr : jsonStr.slice(0, maxLength) + '...'}
      </pre>
      <div className="flex items-center gap-2 mt-1">
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-pink-500 hover:text-pink-400"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
        <button
          onClick={handleCopy}
          className="text-xs text-zinc-500 hover:text-zinc-400 flex items-center gap-1"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function LogEntry({ entry }: { entry: DebugLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const colors = SOURCE_COLORS[entry.source];
  const levelColor = LEVEL_COLORS[entry.level];
  const hasDetails = entry.details && Object.keys(entry.details).length > 0;

  return (
    <div className={`${colors.bg} rounded-lg p-3`}>
      <div className="flex items-start gap-2">
        <span className={`flex-shrink-0 ${colors.icon}`}>
          {getSourceIcon(entry.source)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs mb-1">
            <span className={`font-medium ${colors.text}`}>
              {entry.source}
            </span>
            <span className={`uppercase font-medium ${levelColor}`}>
              {entry.level}
            </span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {formatTime(entry.timestamp)}
            </span>
          </div>
          <div className="text-sm text-zinc-700 dark:text-zinc-200 break-words">
            {entry.message}
          </div>
          {hasDetails && (
            <div className="mt-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 flex items-center gap-1"
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Details
              </button>
              {expanded && (
                <div className="mt-2">
                  <ExpandableJSON data={entry.details} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AIRequestEntry({ entry }: { entry: AIRequestLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isRequest = entry.type === 'request';
  const bgColor = isRequest
    ? 'bg-pink-100 dark:bg-pink-900/30'
    : entry.error
    ? 'bg-red-100 dark:bg-red-900/30'
    : 'bg-green-100 dark:bg-green-900/30';

  return (
    <div className={`${bgColor} rounded-lg p-3`}>
      <div className="flex items-start gap-2">
        <span className={`flex-shrink-0 ${isRequest ? 'text-pink-500' : entry.error ? 'text-red-500' : 'text-green-500'}`}>
          <Braces size={14} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs mb-1 flex-wrap">
            <span className={`font-medium ${isRequest ? 'text-pink-700 dark:text-pink-300' : entry.error ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>
              {isRequest ? 'REQUEST' : 'RESPONSE'}
            </span>
            {entry.tickNumber !== undefined && (
              <span className="text-zinc-600 dark:text-zinc-400">
                Tick #{entry.tickNumber}
              </span>
            )}
            {entry.model && (
              <span className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                {entry.model}
              </span>
            )}
            <span className="text-zinc-500 dark:text-zinc-400">
              {formatTime(entry.timestamp)}
            </span>
          </div>

          {/* Error display */}
          {entry.error && (
            <div className="text-sm text-red-600 dark:text-red-400 font-medium">
              Error: {entry.error}
            </div>
          )}

          {/* Response content preview */}
          {entry.content && (
            <div className="text-sm text-zinc-700 dark:text-zinc-200 line-clamp-2">
              {entry.content.slice(0, 200)}{entry.content.length > 200 ? '...' : ''}
            </div>
          )}

          {/* Tool calls preview */}
          {entry.toolCalls && entry.toolCalls.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {entry.toolCalls.map((tc, i) => (
                <span
                  key={i}
                  className="px-1.5 py-0.5 text-xs rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                >
                  {tc.name}
                </span>
              ))}
            </div>
          )}

          {/* Usage info */}
          {entry.usage && (
            <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Tokens: {entry.usage.prompt_tokens ?? 0} in / {entry.usage.completion_tokens ?? 0} out
              {entry.usage.total_tokens ? ` (${entry.usage.total_tokens} total)` : ''}
            </div>
          )}

          {/* Expand button for full details */}
          <div className="mt-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 flex items-center gap-1"
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Full Details
            </button>
            {expanded && (
              <div className="mt-2 space-y-2">
                {entry.messages && (
                  <div>
                    <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Messages:</div>
                    <ExpandableJSON data={entry.messages} maxLength={500} />
                  </div>
                )}
                {entry.toolCalls && entry.toolCalls.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Tool Calls:</div>
                    <ExpandableJSON data={entry.toolCalls} maxLength={500} />
                  </div>
                )}
                {entry.content && (
                  <div>
                    <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Content:</div>
                    <pre className="text-xs font-mono bg-zinc-900 text-zinc-300 p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-64">
                      {entry.content}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DebugPanel({ isOpen, onClose }: DebugPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('logs');
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  const [aiRequests, setAIRequests] = useState<AIRequestLogEntry[]>([]);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState({ logCount: 0, aiRequestCount: 0 });
  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (sourceFilter !== 'all') {
        params.set('source', sourceFilter);
      }
      const res = await fetch(`/api/debug/logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setStats(data.stats || { logCount: 0, aiRequestCount: 0 });
      }
    } catch (err) {
      console.error('Failed to fetch debug logs:', err);
    }
  }, [sourceFilter]);

  const fetchAIRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/debug/ai-requests?limit=100');
      if (res.ok) {
        const data = await res.json();
        setAIRequests(data.requests || []);
        setStats(data.stats || { logCount: 0, aiRequestCount: 0 });
      }
    } catch (err) {
      console.error('Failed to fetch AI requests:', err);
    }
  }, []);

  const clearLogs = async () => {
    try {
      await fetch('/api/debug/logs', { method: 'DELETE' });
      setLogs([]);
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  };

  const clearAIRequests = async () => {
    try {
      await fetch('/api/debug/ai-requests', { method: 'DELETE' });
      setAIRequests([]);
    } catch (err) {
      console.error('Failed to clear AI requests:', err);
    }
  };

  const refresh = () => {
    setIsLoading(true);
    Promise.all([
      activeTab === 'logs' ? fetchLogs() : Promise.resolve(),
      activeTab === 'ai-requests' ? fetchAIRequests() : Promise.resolve(),
    ]).finally(() => setIsLoading(false));
  };

  // Fetch data when panel opens or tab/filter changes
  useEffect(() => {
    if (!isOpen) return;

    if (activeTab === 'logs') {
      fetchLogs();
    } else {
      fetchAIRequests();
    }

    // Poll for updates
    const interval = setInterval(() => {
      if (activeTab === 'logs') {
        fetchLogs();
      } else {
        fetchAIRequests();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isOpen, activeTab, sourceFilter, fetchLogs, fetchAIRequests]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isAutoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, aiRequests, isAutoScroll]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredLogs = sourceFilter === 'all'
    ? logs
    : logs.filter(l => l.source === sourceFilter);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-zinc-800 rounded-lg w-full max-w-4xl mx-4 shadow-xl h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold">Debug Panel</h2>
            <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-700 rounded-lg p-1">
              <button
                onClick={() => setActiveTab('logs')}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  activeTab === 'logs'
                    ? 'bg-white dark:bg-zinc-600 text-zinc-900 dark:text-white shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                Logs ({stats.logCount})
              </button>
              <button
                onClick={() => setActiveTab('ai-requests')}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  activeTab === 'ai-requests'
                    ? 'bg-white dark:bg-zinc-600 text-zinc-900 dark:text-white shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                AI Requests ({stats.aiRequestCount})
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            {activeTab === 'logs' && (
              <div className="flex items-center gap-1">
                <Filter size={14} className="text-zinc-500 dark:text-zinc-400" />
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
                  className="text-sm bg-zinc-100 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 focus:outline-none focus:border-pink-500"
                >
                  <option value="all">All Sources</option>
                  <option value="server">Server</option>
                  <option value="daemon">Daemon</option>
                  <option value="orchestrator">Orchestrator</option>
                  <option value="ai-api">AI API</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAutoScroll(!isAutoScroll)}
              className={`p-1.5 rounded-md transition-colors ${
                isAutoScroll
                  ? 'text-pink-500 dark:text-pink-400 bg-pink-100 dark:bg-pink-900/30'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'
              }`}
              title={isAutoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
            >
              {isAutoScroll ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button
              onClick={activeTab === 'logs' ? clearLogs : clearAIRequests}
              className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-md transition-colors"
              title="Clear"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={refresh}
              disabled={isLoading}
              className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-md transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          ref={logContainerRef}
          className="flex-1 overflow-y-auto p-4 space-y-2"
        >
          {activeTab === 'logs' ? (
            filteredLogs.length === 0 ? (
              <div className="text-zinc-500 text-center py-8 text-sm">
                No logs yet
              </div>
            ) : (
              filteredLogs.map((entry) => (
                <LogEntry key={entry.id} entry={entry} />
              ))
            )
          ) : (
            aiRequests.length === 0 ? (
              <div className="text-zinc-500 text-center py-8 text-sm">
                No AI requests yet
              </div>
            ) : (
              aiRequests.map((entry) => (
                <AIRequestEntry key={entry.id} entry={entry} />
              ))
            )
          )}
        </div>
      </div>
    </div>
  );
}
