import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  RefreshCw,
  Trash2,
  FileEdit,
  Terminal,
  GitCommit,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  Bot,
  Cpu,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { useProjectStore } from '../../stores/project.store';

interface ActivityLogProps {
  projectId: string;
}

interface ActivityEntry {
  id: number;
  timestamp: string;
  type: string;
  category: string;
  summary: string;
  details: string;
}

type ActivityKind =
  | 'file_edit'
  | 'command'
  | 'commit'
  | 'question'
  | 'task_complete'
  | 'error'
  | 'progress'
  | 'orchestrator'
  | 'system'
  | 'default';

const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  file_edit: 'File Edits',
  command: 'Commands',
  commit: 'Commits',
  question: 'Questions',
  task_complete: 'Task Complete',
  error: 'Errors',
  progress: 'Progress',
  orchestrator: 'Orchestrator',
  system: 'System',
  default: 'Other',
};

const ALL_ACTIVITY_KINDS: ActivityKind[] = [
  'file_edit',
  'command',
  'commit',
  'question',
  'task_complete',
  'error',
  'progress',
  'orchestrator',
  'system',
  'default',
];

interface FilterState {
  enabledTypes: Set<ActivityKind>;
  onlyBranches: boolean;
}

function getActivityKind(entry: ActivityEntry): ActivityKind {
  const detailsObj = JSON.parse(entry.details || '{}');
  const summary = entry.summary.toLowerCase();

  // Agent-specific activities
  if (detailsObj.activityType) {
    return detailsObj.activityType as ActivityKind;
  }

  // Infer from summary/category
  // Check for "Agent progress:" first to avoid false positives with "completed" keyword
  if (summary.toLowerCase().startsWith('agent progress:')) {
    return 'progress';
  }
  if (summary.includes('completed') || summary.includes('task complete')) {
    return 'task_complete';
  }
  if (summary.includes('question')) {
    return 'question';
  }
  if (summary.includes('commit')) {
    return 'commit';
  }
  if (summary.includes('edit') || summary.includes('modified') || summary.includes('wrote')) {
    return 'file_edit';
  }
  if (summary.includes('command') || summary.includes('ran') || summary.includes('executed')) {
    return 'command';
  }
  if (entry.type === 'error') {
    return 'error';
  }
  if (summary.includes('progress')) {
    return 'progress';
  }
  if (entry.category === 'orchestrator') {
    return 'orchestrator';
  }
  if (entry.category === 'system') {
    return 'system';
  }

  return 'default';
}

function getActivityIcon(kind: ActivityKind) {
  switch (kind) {
    case 'file_edit':
      return <FileEdit size={12} />;
    case 'command':
      return <Terminal size={12} />;
    case 'commit':
      return <GitCommit size={12} />;
    case 'question':
      return <HelpCircle size={12} />;
    case 'task_complete':
      return <CheckCircle2 size={12} />;
    case 'error':
      return <AlertCircle size={12} />;
    case 'progress':
      return <Bot size={12} />;
    case 'orchestrator':
      return <Cpu size={12} />;
    case 'system':
      return <MessageSquare size={12} />;
    default:
      return <Activity size={12} />;
  }
}

function getActivityColors(kind: ActivityKind) {
  switch (kind) {
    case 'file_edit':
      return {
        icon: 'text-blue-500 dark:text-blue-400',
        bg: 'bg-blue-100 dark:bg-blue-900/30',
      };
    case 'command':
      return {
        icon: 'text-purple-500 dark:text-purple-400',
        bg: 'bg-purple-100 dark:bg-purple-900/30',
      };
    case 'commit':
      return {
        icon: 'text-orange-500 dark:text-orange-400',
        bg: 'bg-orange-100 dark:bg-orange-900/30',
      };
    case 'question':
      return {
        icon: 'text-yellow-500 dark:text-yellow-400',
        bg: 'bg-yellow-100 dark:bg-yellow-900/30',
      };
    case 'task_complete':
      return {
        icon: 'text-emerald-500 dark:text-emerald-400',
        bg: 'bg-emerald-100 dark:bg-emerald-900/30',
      };
    case 'error':
      return {
        icon: 'text-red-500 dark:text-red-400',
        bg: 'bg-red-100 dark:bg-red-900/30',
      };
    case 'progress':
      return {
        icon: 'text-cyan-500 dark:text-cyan-400',
        bg: 'bg-cyan-100 dark:bg-cyan-900/30',
      };
    case 'orchestrator':
      return {
        icon: 'text-indigo-500 dark:text-indigo-400',
        bg: 'bg-indigo-100 dark:bg-indigo-900/30',
      };
    case 'system':
      return {
        icon: 'text-zinc-500 dark:text-zinc-400',
        bg: 'bg-zinc-100 dark:bg-zinc-800/50',
      };
    default:
      return {
        icon: 'text-zinc-500 dark:text-zinc-400',
        bg: 'bg-zinc-100 dark:bg-zinc-800/50',
      };
  }
}

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

function extractAgentBranch(entry: ActivityEntry): string | null {
  const detailsObj = JSON.parse(entry.details || '{}');
  return detailsObj.branch || detailsObj.worktreeId?.split('-')[0] || null;
}

function extractWorktreeId(entry: ActivityEntry): string | null {
  try {
    const detailsObj = JSON.parse(entry.details || '{}');
    return detailsObj.worktreeId || null;
  } catch {
    return null;
  }
}

function getEntrySource(entry: ActivityEntry): string {
  if (entry.category === 'orchestrator') {
    return 'Orchestrator';
  }
  if (entry.category === 'system') {
    return 'System';
  }
  const branch = extractAgentBranch(entry);
  if (branch) {
    return branch;
  }
  if (entry.category === 'agent') {
    return 'Agent';
  }
  return 'General';
}

interface GroupedEntries {
  source: string;
  entries: ActivityEntry[];
}

function groupEntriesBySource(entries: ActivityEntry[]): GroupedEntries[] {
  const groupMap = new Map<string, ActivityEntry[]>();
  const groupOrder: string[] = [];

  for (const entry of entries) {
    const source = getEntrySource(entry);
    if (!groupMap.has(source)) {
      groupMap.set(source, []);
      groupOrder.push(source);
    }
    groupMap.get(source)!.push(entry);
  }

  return groupOrder.map((source) => ({
    source,
    entries: groupMap.get(source)!,
  }));
}

export function ActivityLog({ projectId }: ActivityLogProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const setActiveWorktree = useProjectStore((state) => state.setActiveWorktree);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('activityLog.collapsedSections');
      if (saved) {
        try {
          return new Set(JSON.parse(saved));
        } catch {
          return new Set();
        }
      }
    }
    return new Set();
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('activityLog.filters');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return {
            enabledTypes: new Set(parsed.enabledTypes || ALL_ACTIVITY_KINDS),
            onlyBranches: parsed.onlyBranches || false,
          };
        } catch {
          return { enabledTypes: new Set(ALL_ACTIVITY_KINDS), onlyBranches: false };
        }
      }
    }
    return { enabledTypes: new Set(ALL_ACTIVITY_KINDS), onlyBranches: false };
  });
  const filterRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const toggleSection = useCallback((source: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      localStorage.setItem('activityLog.collapsedSections', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const updateFilters = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    localStorage.setItem('activityLog.filters', JSON.stringify({
      enabledTypes: [...newFilters.enabledTypes],
      onlyBranches: newFilters.onlyBranches,
    }));
  }, []);

  const toggleTypeFilter = useCallback((kind: ActivityKind) => {
    setFilters((prev) => {
      const next = new Set(prev.enabledTypes);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      const newFilters = { ...prev, enabledTypes: next };
      localStorage.setItem('activityLog.filters', JSON.stringify({
        enabledTypes: [...next],
        onlyBranches: prev.onlyBranches,
      }));
      return newFilters;
    });
  }, []);

  const toggleOnlyBranches = useCallback(() => {
    setFilters((prev) => {
      const newFilters = { ...prev, onlyBranches: !prev.onlyBranches };
      localStorage.setItem('activityLog.filters', JSON.stringify({
        enabledTypes: [...prev.enabledTypes],
        onlyBranches: newFilters.onlyBranches,
      }));
      return newFilters;
    });
  }, []);

  const resetFilters = useCallback(() => {
    const defaultFilters = { enabledTypes: new Set(ALL_ACTIVITY_KINDS), onlyBranches: false };
    updateFilters(defaultFilters);
  }, [updateFilters]);

  // Close filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    };
    if (filterOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [filterOpen]);

  // Apply filters to entries
  const filteredEntries = entries.filter((entry) => {
    const kind = getActivityKind(entry);
    if (!filters.enabledTypes.has(kind)) {
      return false;
    }
    if (filters.onlyBranches) {
      const source = getEntrySource(entry);
      // Only show branch-related entries (not Orchestrator, System, Agent, General)
      if (['Orchestrator', 'System', 'Agent', 'General'].includes(source)) {
        return false;
      }
    }
    return true;
  });

  const groupedEntries = groupEntriesBySource(filteredEntries);

  const hasActiveFilters = filters.enabledTypes.size < ALL_ACTIVITY_KINDS.length || filters.onlyBranches;

  const clearLog = async () => {
    setIsClearing(true);
    try {
      const res = await fetch(`/api/orchestrator/log/clear?projectId=${projectId}`, {
        method: 'POST',
      });
      if (res.ok) {
        setEntries([]);
      }
    } catch (err) {
      console.error('Failed to clear activity log:', err);
    } finally {
      setIsClearing(false);
    }
  };

  const fetchLog = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/activity?projectId=${projectId}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch (err) {
      console.error('Failed to fetch activity log:', err);
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
  }, [entries]);

  return (
    <div className="h-full flex flex-col bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
      <div className="flex items-center justify-end px-3 py-2 bg-zinc-200/50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-1">
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className={`p-1.5 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-full transition-colors ${
                hasActiveFilters
                  ? 'text-blue-500 dark:text-blue-400'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
              }`}
              title="Filter activity"
            >
              <Filter size={14} />
            </button>
            {filterOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-zinc-800 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-700 z-50 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Filters</span>
                  {hasActiveFilters && (
                    <button
                      onClick={resetFilters}
                      className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      Reset
                    </button>
                  )}
                </div>
                <div className="p-2 space-y-1 max-h-64 overflow-y-auto">
                  <div className="px-2 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    Activity Types
                  </div>
                  {ALL_ACTIVITY_KINDS.map((kind) => {
                    const colors = getActivityColors(kind);
                    const isEnabled = filters.enabledTypes.has(kind);
                    return (
                      <label
                        key={kind}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700/50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => toggleTypeFilter(kind)}
                          className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                        />
                        <span className={`p-1 rounded ${colors.bg} ${colors.icon}`}>
                          {getActivityIcon(kind)}
                        </span>
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">
                          {ACTIVITY_KIND_LABELS[kind]}
                        </span>
                      </label>
                    );
                  })}
                  <div className="border-t border-zinc-200 dark:border-zinc-700 my-2" />
                  <div className="px-2 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    Source
                  </div>
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.onlyBranches}
                      onChange={toggleOnlyBranches}
                      className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">
                      Only show branch updates
                    </span>
                  </label>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={clearLog}
            disabled={isClearing || entries.length === 0}
            className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-full transition-colors disabled:opacity-50"
            title="Clear log"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={fetchLog}
            disabled={isLoading}
            className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-full transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div
        ref={logRef}
        className="flex-1 overflow-y-auto p-3 space-y-3"
      >
        {filteredEntries.length === 0 ? (
          <div className="text-zinc-500 text-center py-8 text-sm">
            {entries.length === 0 ? 'No activity yet' : 'No activity matches filters'}
          </div>
        ) : (
          groupedEntries.map((group) => {
            const isCollapsed = collapsedSections.has(group.source);

            return (
              <div key={group.source} className="bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl overflow-hidden">
                <button
                  onClick={() => toggleSection(group.source)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-zinc-300/50 dark:hover:bg-zinc-700/50 transition-colors"
                >
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </span>
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {group.source}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-300 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400">
                    {group.entries.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="px-3 pb-3 space-y-2">
                    {group.entries.map((entry) => {
                      const kind = getActivityKind(entry);
                      const colors = getActivityColors(kind);
                      const worktreeId = extractWorktreeId(entry);
                      const isClickable = !!worktreeId;

                      const handleClick = () => {
                        if (worktreeId) {
                          setActiveWorktree(worktreeId);
                        }
                      };

                      return (
                        <div
                          key={entry.id}
                          onClick={isClickable ? handleClick : undefined}
                          className={`flex items-start gap-3 px-4 py-3 rounded-2xl text-sm ${colors.bg} shadow-sm ${
                            isClickable
                              ? 'cursor-pointer hover:ring-2 hover:ring-blue-400 dark:hover:ring-blue-500 hover:ring-offset-1 dark:hover:ring-offset-zinc-900 transition-shadow'
                              : ''
                          }`}
                        >
                          <div className={`flex-shrink-0 mt-0.5 p-1.5 rounded-full bg-white/50 dark:bg-black/20 ${colors.icon}`}>
                            {getActivityIcon(kind)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-zinc-700 dark:text-zinc-200 break-words leading-relaxed">
                              {entry.summary}
                            </div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                              {formatTime(entry.timestamp)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Backward compatibility export
export { ActivityLog as OrchestratorLog };
