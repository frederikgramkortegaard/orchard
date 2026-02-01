import { useState, useEffect, useMemo } from 'react';
import { X, GitCommit, User, Calendar, FileText, Plus, Minus, Edit3 } from 'lucide-react';
import { html, parse } from 'diff2html';
import {
  fetchCommitDetail,
  fetchCommitCompare,
  type CommitDetailResult,
} from '../../api/projects';

interface CommitDetailModalProps {
  isOpen: boolean;
  worktreeId: string;
  commitHash: string | null;
  compareBase?: string | null;
  compareTarget?: string | null;
  onClose: () => void;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function getFileStatusIcon(status: string) {
  switch (status) {
    case 'added':
      return <Plus size={14} className="text-emerald-500" />;
    case 'deleted':
      return <Minus size={14} className="text-red-500" />;
    default:
      return <Edit3 size={14} className="text-blue-500" />;
  }
}

function getFileStatusColor(status: string) {
  switch (status) {
    case 'added':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'deleted':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-blue-600 dark:text-blue-400';
  }
}

export function CommitDetailModal({
  isOpen,
  worktreeId,
  commitHash,
  compareBase,
  compareTarget,
  onClose,
}: CommitDetailModalProps) {
  const [detail, setDetail] = useState<CommitDetailResult | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCompareMode = !!(compareBase && compareTarget);

  useEffect(() => {
    if (!isOpen || !worktreeId) {
      setDetail(null);
      setDiff(null);
      setError(null);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        if (isCompareMode) {
          // Compare mode
          const result = await fetchCommitCompare(worktreeId, compareBase!, compareTarget!);
          setDiff(result.diff);
          setDetail(null);
        } else if (commitHash) {
          // Single commit mode
          const result = await fetchCommitDetail(worktreeId, commitHash);
          setDetail(result);
          setDiff(result.diff);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load details');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [isOpen, worktreeId, commitHash, compareBase, compareTarget, isCompareMode]);

  const htmlContent = useMemo(() => {
    if (!diff) return '';

    try {
      const parsed = parse(diff);
      return html(parsed, {
        outputFormat: 'side-by-side',
        drawFileList: true,
        matching: 'lines',
      });
    } catch (err) {
      console.error('Error parsing diff:', err);
      return '';
    }
  }, [diff]);

  if (!isOpen) return null;

  const title = isCompareMode
    ? `Compare: ${compareBase?.slice(0, 7)} ... ${compareTarget?.slice(0, 7)}`
    : `Commit: ${commitHash?.slice(0, 7)}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-zinc-800 rounded-lg w-full max-w-6xl h-[85vh] mx-4 shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <GitCommit size={20} className="text-zinc-500" />
            <h2 className="text-lg font-semibold">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700"
          >
            <X size={20} />
          </button>
        </div>

        {/* Commit info (single commit mode only) */}
        {!isCompareMode && detail && (
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 flex-shrink-0">
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-base font-medium text-zinc-900 dark:text-zinc-100 mb-2">
                  {detail.commit.message}
                </p>
                <div className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
                  <span className="flex items-center gap-1">
                    <User size={14} />
                    {detail.commit.author}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar size={14} />
                    {formatDate(detail.commit.date)}
                  </span>
                  <code className="font-mono text-xs bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded">
                    {detail.commit.hash}
                  </code>
                </div>
              </div>
            </div>

            {/* Changed files summary */}
            {detail.files.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {detail.files.slice(0, 10).map((file) => (
                  <span
                    key={file.path}
                    className={`inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 ${getFileStatusColor(
                      file.status
                    )}`}
                  >
                    {getFileStatusIcon(file.status)}
                    {file.path.split('/').pop()}
                    {(file.additions > 0 || file.deletions > 0) && (
                      <span className="text-zinc-400 ml-1">
                        +{file.additions} -{file.deletions}
                      </span>
                    )}
                  </span>
                ))}
                {detail.files.length > 10 && (
                  <span className="text-xs text-zinc-500">
                    +{detail.files.length - 10} more
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-zinc-300 dark:border-zinc-600 border-t-blue-500 rounded-full animate-spin" />
                <span>Loading diff...</span>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="px-4 py-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-200 text-sm">
                {error}
              </div>
            </div>
          ) : !diff ? (
            <div className="flex items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
              <div className="text-center">
                <FileText size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-lg mb-2">No changes</p>
                <p className="text-sm">This commit has no file changes</p>
              </div>
            </div>
          ) : (
            <div
              className="diff-viewer-content h-full overflow-auto"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
