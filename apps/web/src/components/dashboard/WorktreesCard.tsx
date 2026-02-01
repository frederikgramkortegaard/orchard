import { GitBranch, Clock, AlertCircle, CheckCircle, FileText, Play, AlertTriangle } from 'lucide-react';
import type { Worktree } from '../../stores/project.store';
import { useState } from 'react';

interface WorktreesCardProps {
  worktrees: Worktree[];
  onApprove?: (worktreeId: string) => void;
}

export function WorktreesCard({ worktrees, onApprove }: WorktreesCardProps) {
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const activeWorktrees = worktrees.filter((w) => !w.archived);
  const archivedCount = worktrees.filter((w) => w.archived).length;
  const mergedCount = worktrees.filter((w) => w.merged).length;
  const planModeCount = worktrees.filter((w) => w.mode === 'plan' && !w.archived).length;
  const conflictCount = worktrees.filter((w) => w.conflictingFiles && w.conflictingFiles.length > 0 && !w.archived).length;

  const handleApprove = async (worktreeId: string) => {
    setApprovingId(worktreeId);
    try {
      if (onApprove) {
        await onApprove(worktreeId);
      }
    } finally {
      setApprovingId(null);
    }
  };

  const getStatusColor = (worktree: Worktree) => {
    if (worktree.conflictingFiles && worktree.conflictingFiles.length > 0) return 'text-red-500';
    if (worktree.merged) return 'text-emerald-500';
    if (worktree.status.modified > 0 || worktree.status.staged > 0) return 'text-amber-500';
    return 'text-blue-500';
  };

  const getStatusIcon = (worktree: Worktree) => {
    // Conflict warning takes priority
    if (worktree.conflictingFiles && worktree.conflictingFiles.length > 0) {
      return <AlertTriangle size={12} className="text-red-500" />;
    }
    if (worktree.merged) return <CheckCircle size={12} className="text-emerald-500" />;
    if (worktree.status.modified > 0 || worktree.status.staged > 0) {
      return <AlertCircle size={12} className="text-amber-500" />;
    }
    return <GitBranch size={12} className="text-blue-500" />;
  };

  const hasConflicts = (worktree: Worktree) => {
    return worktree.conflictingFiles && worktree.conflictingFiles.length > 0;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitBranch size={16} className="text-purple-500" />
          <h3 className="text-sm font-medium">Active Worktrees</h3>
        </div>
        <div className="flex gap-3 text-xs text-zinc-500">
          <span>{activeWorktrees.length} active</span>
          {conflictCount > 0 && <span className="text-red-500">{conflictCount} conflicts</span>}
          {planModeCount > 0 && <span className="text-purple-500">{planModeCount} planning</span>}
          <span>{mergedCount} merged</span>
          <span>{archivedCount} archived</span>
        </div>
      </div>

      <div className="space-y-2 max-h-[200px] overflow-y-auto">
        {activeWorktrees.length === 0 ? (
          <div className="text-zinc-500 text-sm text-center py-4">No active worktrees</div>
        ) : (
          activeWorktrees.map((worktree) => (
            <div
              key={worktree.id}
              className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-700"
            >
              <div className="flex items-center gap-2 min-w-0">
                {getStatusIcon(worktree)}
                <span className={`text-sm font-medium truncate ${getStatusColor(worktree)}`}>
                  {worktree.branch}
                </span>
                {worktree.isMain && (
                  <span className="text-xs bg-blue-500/20 text-blue-500 px-1.5 py-0.5 rounded">main</span>
                )}
                {worktree.mode === 'plan' && (
                  <span className="text-xs bg-purple-500/20 text-purple-500 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <FileText size={10} />
                    plan
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-500 flex-shrink-0">
                {worktree.mode === 'plan' && onApprove && (
                  <button
                    onClick={() => handleApprove(worktree.id)}
                    disabled={approvingId === worktree.id}
                    className="flex items-center gap-1 px-2 py-1 bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30 rounded transition-colors disabled:opacity-50"
                  >
                    <Play size={10} />
                    {approvingId === worktree.id ? 'Approving...' : 'Approve'}
                  </button>
                )}
                {hasConflicts(worktree) && (
                  <span className="flex items-center gap-1 text-red-500" title={`Conflicting files: ${worktree.conflictingFiles?.join(', ')}`}>
                    <AlertTriangle size={10} />
                    {worktree.conflictingFiles?.length} conflict{worktree.conflictingFiles?.length !== 1 ? 's' : ''}
                  </span>
                )}
                {(worktree.status.modified > 0 || worktree.status.staged > 0 || worktree.status.untracked > 0) && (
                  <span className="text-amber-500">
                    {worktree.status.modified + worktree.status.staged + worktree.status.untracked} changes
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock size={10} />
                  {formatDate(worktree.lastCommitDate)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
