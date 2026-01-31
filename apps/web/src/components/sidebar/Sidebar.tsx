import { Plus, GitBranch, Folder, Trash2, CheckCircle, Archive } from 'lucide-react';
import { useProjectStore, type Worktree } from '../../stores/project.store';
import { OrchestratorPanel } from '../orchestrator/OrchestratorPanel';

interface SidebarProps {
  onOpenProject: () => void;
  onCreateWorktree: () => void;
  onDeleteWorktree: (worktreeId: string) => void;
  onArchiveWorktree: (worktreeId: string) => void;
}

export function Sidebar({ onOpenProject, onCreateWorktree, onDeleteWorktree, onArchiveWorktree }: SidebarProps) {
  const { projects, activeProjectId, worktrees, activeWorktreeId, setActiveWorktree } = useProjectStore();

  const activeProject = projects.find(p => p.id === activeProjectId);

  const getStatusIndicator = (worktree: Worktree) => {
    const { modified, staged, untracked, ahead, behind } = worktree.status;
    const hasChanges = modified > 0 || staged > 0 || untracked > 0;

    if (hasChanges) {
      return <span className="w-2 h-2 rounded-full bg-yellow-500" title={`${modified} modified, ${staged} staged, ${untracked} untracked`} />;
    }
    if (ahead > 0 || behind > 0) {
      return <span className="text-xs text-zinc-400 dark:text-zinc-500">{ahead > 0 && `↑${ahead}`}{behind > 0 && `↓${behind}`}</span>;
    }
    return <span className="w-2 h-2 rounded-full bg-green-500" title="Clean" />;
  };

  const worktreesContent = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Worktrees header */}
      <div className="px-4 py-3 border-b border-zinc-300 dark:border-zinc-700 flex items-center justify-between flex-shrink-0">
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">WORKTREES</h2>
        <button
          onClick={onCreateWorktree}
          disabled={!activeProjectId}
          className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
          title="New Worktree"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Worktrees list */}
      <div className="flex-1 overflow-y-auto p-2">
        {!activeProjectId ? (
          <div className="text-center py-8 text-zinc-500">
            <Folder size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No project selected</p>
            <button
              onClick={onOpenProject}
              className="mt-2 text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 text-sm"
            >
              Open a project
            </button>
          </div>
        ) : worktrees.length === 0 ? (
          <div className="text-center py-8 text-zinc-500">
            <GitBranch size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No worktrees</p>
            <button
              onClick={onCreateWorktree}
              className="mt-2 text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 text-sm"
            >
              Create a worktree
            </button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {worktrees.map((worktree) => (
              <button
                key={worktree.id}
                onClick={() => setActiveWorktree(worktree.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded text-left group ${
                  activeWorktreeId === worktree.id ? 'bg-zinc-300 dark:bg-zinc-600' : 'hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50'
                } ${worktree.merged ? 'opacity-60' : ''}`}
              >
                {worktree.merged ? (
                  <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                ) : (
                  <GitBranch size={14} className="text-zinc-500 dark:text-zinc-400 flex-shrink-0" />
                )}
                <span className={`flex-1 truncate text-sm ${worktree.merged ? 'text-zinc-400 dark:text-zinc-500' : ''}`}>
                  {worktree.branch}
                  {worktree.isMain && <span className="text-zinc-400 dark:text-zinc-500 ml-1">(main)</span>}
                  {worktree.merged && <span className="text-green-500 ml-1">(merged)</span>}
                </span>
                {!worktree.merged && getStatusIndicator(worktree)}
                {!worktree.isMain && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchiveWorktree(worktree.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-500 dark:text-zinc-400 hover:text-amber-500 dark:hover:text-amber-400"
                    title="Archive worktree (close session)"
                  >
                    <Archive size={12} />
                  </button>
                )}
                {!worktree.isMain && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteWorktree(worktree.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400"
                    title="Delete worktree"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <aside className="h-full bg-zinc-100 dark:bg-zinc-800 border-r border-zinc-300 dark:border-zinc-700 flex flex-col overflow-hidden">
      {/* Orchestrator input - simple row at top */}
      {activeProjectId && activeProject && (
        <div className="p-2 border-b border-zinc-300 dark:border-zinc-700 flex-shrink-0">
          <OrchestratorPanel projectId={activeProjectId} projectPath={activeProject.path} />
        </div>
      )}

      {/* Worktrees section */}
      <div className="flex-1 overflow-hidden">
        {worktreesContent}
      </div>
    </aside>
  );
}
