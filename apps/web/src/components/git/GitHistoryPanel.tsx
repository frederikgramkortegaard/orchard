import { useState, useEffect } from 'react';
import { GitCommit, GitBranch, RefreshCw, User, Clock } from 'lucide-react';
import {
  fetchProjectHistory,
  fetchWorktreeHistory,
  type GitCommitInfo,
  type GitHistoryResult,
} from '../../api/projects';

interface GitHistoryPanelProps {
  projectId?: string;
  worktreeId?: string;
  worktreeBranch?: string;
}

export function GitHistoryPanel({ projectId, worktreeId, worktreeBranch }: GitHistoryPanelProps) {
  const [history, setHistory] = useState<GitHistoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isProjectMode = !worktreeId && !!projectId;

  useEffect(() => {
    const loadHistory = async () => {
      if (!projectId && !worktreeId) return;

      setLoading(true);
      setError(null);

      try {
        let result: GitHistoryResult;
        if (worktreeId) {
          result = await fetchWorktreeHistory(worktreeId, 50);
        } else if (projectId) {
          result = await fetchProjectHistory(projectId, 50);
        } else {
          return;
        }
        setHistory(result);
      } catch (err: any) {
        setError(err.message || 'Failed to load history');
        setHistory(null);
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [projectId, worktreeId]);

  const handleRefresh = async () => {
    if (!projectId && !worktreeId) return;

    setLoading(true);
    setError(null);

    try {
      let result: GitHistoryResult;
      if (worktreeId) {
        result = await fetchWorktreeHistory(worktreeId, 50);
      } else if (projectId) {
        result = await fetchProjectHistory(projectId, 50);
      } else {
        return;
      }
      setHistory(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load history');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    }
  };

  if (!projectId && !worktreeId) {
    return (
      <div className="h-full flex flex-col bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
        <div className="p-4 text-center text-zinc-500 dark:text-zinc-400">
          <GitCommit size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">Select a project to view git history</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <GitCommit size={16} className="text-pink-500" />
          <h3 className="text-sm font-semibold">
            {isProjectMode ? 'Project History' : 'Branch History'}
          </h3>
          {isProjectMode && (
            <span className="text-xs bg-pink-100 dark:bg-pink-900/50 text-pink-600 dark:text-pink-300 px-1.5 py-0.5 rounded">
              All branches
            </span>
          )}
          {worktreeBranch && (
            <span className="text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 rounded">
              {worktreeBranch}
            </span>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Branches list (only in project mode) */}
      {isProjectMode && history?.branches && history.branches.length > 0 && (
        <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <GitBranch size={12} className="text-zinc-400" />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {history.branches.length} branch{history.branches.length !== 1 ? 'es' : ''}
            </span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && !history ? (
          <div className="p-4 text-center text-zinc-500 dark:text-zinc-400">
            <RefreshCw size={24} className="mx-auto mb-2 animate-spin" />
            <p className="text-sm">Loading history...</p>
          </div>
        ) : error ? (
          <div className="p-4 text-center text-red-500 dark:text-red-400">
            <p className="text-sm">{error}</p>
            <button
              onClick={handleRefresh}
              className="mt-2 text-pink-500 hover:text-pink-400 text-sm"
            >
              Try again
            </button>
          </div>
        ) : history?.commits && history.commits.length > 0 ? (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {history.commits.map((node) => (
              <CommitRow key={node.commit.hash} commit={node.commit} formatDate={formatDate} />
            ))}
          </div>
        ) : (
          <div className="p-4 text-center text-zinc-500 dark:text-zinc-400">
            <p className="text-sm">No commits found</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CommitRow({ commit, formatDate }: { commit: GitCommitInfo; formatDate: (date: string) => string }) {
  return (
    <div className="px-4 py-3 hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <div className="w-6 h-6 rounded-full bg-pink-100 dark:bg-pink-900/50 flex items-center justify-center">
            <GitCommit size={12} className="text-pink-600 dark:text-pink-400" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-900 dark:text-zinc-100 truncate" title={commit.message}>
            {commit.message}
          </p>
          <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-mono text-pink-600 dark:text-pink-400">{commit.hashShort}</span>
            <span className="flex items-center gap-1">
              <User size={10} />
              {commit.author}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {formatDate(commit.date)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
