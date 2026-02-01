import { GitBranch, Clock, AlertCircle, CheckCircle } from 'lucide-react';
import type { Worktree } from '../../stores/project.store';

interface WorktreesCardProps {
  worktrees: Worktree[];
}

export function WorktreesCard({ worktrees }: WorktreesCardProps) {
  const activeWorktrees = worktrees.filter((w) => !w.archived);
  const archivedCount = worktrees.filter((w) => w.archived).length;
  const mergedCount = worktrees.filter((w) => w.merged).length;

  const getStatusColor = (worktree: Worktree) => {
    if (worktree.merged) return 'text-green-500';
    if (worktree.status.modified > 0 || worktree.status.staged > 0) return 'text-amber-500';
    return 'text-blue-500';
  };

  const getStatusIcon = (worktree: Worktree) => {
    if (worktree.merged) return <CheckCircle size={12} className="text-green-500" />;
    if (worktree.status.modified > 0 || worktree.status.staged > 0) {
      return <AlertCircle size={12} className="text-amber-500" />;
    }
    return <GitBranch size={12} className="text-blue-500" />;
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
    <div className="bg-white dark:bg-neutral-800 rounded-xl border border-zinc-200 dark:border-neutral-700 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-purple-500/10 dark:bg-purple-500/20 rounded-lg">
            <GitBranch size={14} className="text-purple-500" />
          </div>
          <h3 className="text-sm font-semibold">Active Worktrees</h3>
        </div>
        <div className="flex gap-3 text-xs text-zinc-400 dark:text-zinc-500">
          <span>{activeWorktrees.length} active</span>
          <span>{mergedCount} merged</span>
          <span>{archivedCount} archived</span>
        </div>
      </div>

      <div className="space-y-2 max-h-[200px] overflow-y-auto">
        {activeWorktrees.length === 0 ? (
          <div className="text-zinc-400 dark:text-zinc-500 text-sm text-center py-6">No active worktrees</div>
        ) : (
          activeWorktrees.map((worktree) => (
            <div
              key={worktree.id}
              className="flex items-center justify-between p-2.5 bg-zinc-50 dark:bg-neutral-900/50 rounded-lg"
            >
              <div className="flex items-center gap-2 min-w-0">
                {getStatusIcon(worktree)}
                <span className={`text-sm font-medium truncate ${getStatusColor(worktree)}`}>
                  {worktree.branch}
                </span>
                {worktree.isMain && (
                  <span className="text-[10px] font-medium bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded-md">main</span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500 flex-shrink-0">
                {(worktree.status.modified > 0 || worktree.status.staged > 0 || worktree.status.untracked > 0) && (
                  <span className="text-amber-500 font-medium">
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
