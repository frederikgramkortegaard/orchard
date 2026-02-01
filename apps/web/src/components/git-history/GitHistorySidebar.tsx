import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  GitCommit,
  GitBranch,
  GitMerge,
  User,
  Calendar,
  ChevronRight,
  ChevronDown,
  FileText,
  Plus,
  Minus,
  Edit3,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  fetchGitHistory,
  fetchCommitFiles,
  type GitHistoryResult,
  type GitGraphNode,
  type CommitFilesResult,
} from '../../api/projects';

interface GitHistorySidebarProps {
  worktreeId: string;
  onViewCommitDiff?: (commitHash: string) => void;
  onCompareCommits?: (base: string, target: string) => void;
}

// Colors for branch visualization
const BRANCH_COLORS = [
  'text-pink-500',
  'text-green-500',
  'text-purple-500',
  'text-orange-500',
  'text-pink-500',
  'text-cyan-500',
];

const BRANCH_BG_COLORS = [
  'bg-pink-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-cyan-500',
];

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return `${diffMinutes}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function getFileIcon(status: string) {
  switch (status) {
    case 'added':
      return <Plus size={12} className="text-green-500" />;
    case 'deleted':
      return <Minus size={12} className="text-red-500" />;
    case 'renamed':
      return <Edit3 size={12} className="text-yellow-500" />;
    default:
      return <Edit3 size={12} className="text-pink-500" />;
  }
}

interface CommitItemProps {
  node: GitGraphNode;
  isSelected: boolean;
  isExpanded: boolean;
  files: CommitFilesResult | null;
  filesLoading: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onViewDiff: () => void;
  compareMode: boolean;
  isCompareBase: boolean;
  isCompareTarget: boolean;
  onSetCompareBase: () => void;
  onSetCompareTarget: () => void;
}

function CommitItem({
  node,
  isSelected,
  isExpanded,
  files,
  filesLoading,
  onSelect,
  onToggleExpand,
  onViewDiff,
  compareMode,
  isCompareBase,
  isCompareTarget,
  onSetCompareBase,
  onSetCompareTarget,
}: CommitItemProps) {
  const { commit, isMerge, branchColor } = node;

  return (
    <div
      className={`group border-l-2 ${BRANCH_COLORS[branchColor].replace('text-', 'border-')} ${
        isSelected
          ? 'bg-pink-50 dark:bg-pink-900/30'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
      }`}
    >
      {/* Commit header */}
      <div
        className="flex items-start gap-2 px-3 py-2 cursor-pointer"
        onClick={onSelect}
      >
        {/* Graph dot */}
        <div className="flex-shrink-0 mt-1 relative">
          {isMerge ? (
            <GitMerge size={14} className={BRANCH_COLORS[branchColor]} />
          ) : (
            <div
              className={`w-3 h-3 rounded-full ${BRANCH_BG_COLORS[branchColor]}`}
            />
          )}
        </div>

        {/* Commit content */}
        <div className="flex-1 min-w-0">
          {/* Hash and refs */}
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
              {commit.hashShort}
            </code>
            {commit.refs.map((ref) => (
              <span
                key={ref}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded bg-pink-100 dark:bg-pink-900/50 text-pink-700 dark:text-pink-300"
              >
                <GitBranch size={10} />
                {ref}
              </span>
            ))}
          </div>

          {/* Message */}
          <p className="text-sm text-zinc-900 dark:text-zinc-100 truncate mt-0.5">
            {commit.message}
          </p>

          {/* Author and date */}
          <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            <span className="flex items-center gap-1">
              <User size={10} />
              {commit.author}
            </span>
            <span className="flex items-center gap-1">
              <Calendar size={10} />
              {formatDate(commit.date)}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {compareMode ? (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSetCompareBase();
                }}
                className={`p-1 rounded text-xs ${
                  isCompareBase
                    ? 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300'
                    : 'hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-600 dark:text-zinc-400'
                }`}
                title="Set as base"
              >
                A
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSetCompareTarget();
                }}
                className={`p-1 rounded text-xs ${
                  isCompareTarget
                    ? 'bg-pink-100 dark:bg-pink-900/50 text-pink-700 dark:text-pink-300'
                    : 'hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-600 dark:text-zinc-400'
                }`}
                title="Set as target"
              >
                B
              </button>
            </>
          ) : (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand();
                }}
                className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded"
                title="Show files"
              >
                {isExpanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDiff();
                }}
                className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded"
                title="View diff"
              >
                <FileText size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded files list */}
      {isExpanded && (
        <div className="pl-8 pr-3 pb-2">
          {filesLoading ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 py-1">
              <Loader2 size={12} className="animate-spin" />
              Loading files...
            </div>
          ) : files ? (
            <div className="space-y-0.5">
              {files.files.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 py-1">
                  No files changed
                </p>
              ) : (
                files.files.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center gap-2 text-xs py-0.5 text-zinc-600 dark:text-zinc-300"
                  >
                    {getFileIcon(file.status)}
                    <span className="truncate font-mono">{file.path}</span>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function GitHistorySidebar({
  worktreeId,
  onViewCommitDiff,
  onCompareCommits,
}: GitHistorySidebarProps) {
  const [history, setHistory] = useState<GitHistoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const [commitFiles, setCommitFiles] = useState<Map<string, CommitFilesResult>>(
    new Map()
  );
  const [filesLoading, setFilesLoading] = useState<Set<string>>(new Set());

  const [compareMode, setCompareMode] = useState(false);
  const [compareBase, setCompareBase] = useState<string | null>(null);
  const [compareTarget, setCompareTarget] = useState<string | null>(null);

  // Load history
  const loadHistory = useCallback(async () => {
    if (!worktreeId) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchGitHistory(worktreeId, 100);
      setHistory(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load git history');
    } finally {
      setLoading(false);
    }
  }, [worktreeId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Load commit files when expanded
  const loadCommitFiles = useCallback(
    async (hash: string) => {
      if (!worktreeId || commitFiles.has(hash)) return;

      setFilesLoading((prev) => new Set(prev).add(hash));

      try {
        const result = await fetchCommitFiles(worktreeId, hash);
        setCommitFiles((prev) => new Map(prev).set(hash, result));
      } catch (err) {
        console.error('Failed to load commit files:', err);
      } finally {
        setFilesLoading((prev) => {
          const next = new Set(prev);
          next.delete(hash);
          return next;
        });
      }
    },
    [worktreeId, commitFiles]
  );

  const handleToggleExpand = useCallback(
    (hash: string) => {
      setExpandedCommits((prev) => {
        const next = new Set(prev);
        if (next.has(hash)) {
          next.delete(hash);
        } else {
          next.add(hash);
          loadCommitFiles(hash);
        }
        return next;
      });
    },
    [loadCommitFiles]
  );

  const handleViewDiff = useCallback(
    (hash: string) => {
      onViewCommitDiff?.(hash);
    },
    [onViewCommitDiff]
  );

  const handleCompare = useCallback(() => {
    if (compareBase && compareTarget && onCompareCommits) {
      onCompareCommits(compareBase, compareTarget);
    }
  }, [compareBase, compareTarget, onCompareCommits]);

  const resetCompare = useCallback(() => {
    setCompareMode(false);
    setCompareBase(null);
    setCompareTarget(null);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
        <div className="flex flex-col items-center gap-2">
          <Loader2 size={24} className="animate-spin" />
          <span className="text-sm">Loading history...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-center">
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-200 text-sm mb-3">
            {error}
          </div>
          <button
            onClick={loadHistory}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded"
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!history || history.commits.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
        <div className="text-center">
          <GitCommit size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">No commits found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <GitCommit size={16} className="text-zinc-500" />
          <span className="text-sm font-medium">History</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded">
            {history.commits.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {compareMode ? (
            <>
              <button
                onClick={handleCompare}
                disabled={!compareBase || !compareTarget}
                className="px-2 py-1 text-xs bg-pink-500 hover:bg-pink-600 disabled:bg-zinc-400 text-white rounded disabled:cursor-not-allowed"
              >
                Compare
              </button>
              <button
                onClick={resetCompare}
                className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded"
                title="Cancel compare"
              >
                <X size={14} />
              </button>
            </>
          ) : (
            <button
              onClick={() => setCompareMode(true)}
              className="px-2 py-1 text-xs bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded"
              title="Compare commits"
            >
              Compare
            </button>
          )}
          <button
            onClick={loadHistory}
            className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Compare status bar */}
      {compareMode && (compareBase || compareTarget) && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
          <span className="text-zinc-500">Comparing:</span>
          {compareBase ? (
            <code className="px-1 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded">
              {compareBase.slice(0, 7)}
            </code>
          ) : (
            <span className="text-zinc-400">Select base (A)</span>
          )}
          <span className="text-zinc-500">...</span>
          {compareTarget ? (
            <code className="px-1 py-0.5 bg-pink-100 dark:bg-pink-900/50 text-pink-700 dark:text-pink-300 rounded">
              {compareTarget.slice(0, 7)}
            </code>
          ) : (
            <span className="text-zinc-400">Select target (B)</span>
          )}
        </div>
      )}

      {/* Current branch info */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
        <GitBranch size={12} className="text-zinc-500" />
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          {history.currentBranch}
        </span>
      </div>

      {/* Commits list */}
      <div className="flex-1 overflow-y-auto">
        {history.commits.map((node) => (
          <CommitItem
            key={node.commit.hash}
            node={node}
            isSelected={selectedCommit === node.commit.hash}
            isExpanded={expandedCommits.has(node.commit.hash)}
            files={commitFiles.get(node.commit.hash) || null}
            filesLoading={filesLoading.has(node.commit.hash)}
            onSelect={() => setSelectedCommit(node.commit.hash)}
            onToggleExpand={() => handleToggleExpand(node.commit.hash)}
            onViewDiff={() => handleViewDiff(node.commit.hash)}
            compareMode={compareMode}
            isCompareBase={compareBase === node.commit.hash}
            isCompareTarget={compareTarget === node.commit.hash}
            onSetCompareBase={() => setCompareBase(node.commit.hash)}
            onSetCompareTarget={() => setCompareTarget(node.commit.hash)}
          />
        ))}
      </div>
    </div>
  );
}
