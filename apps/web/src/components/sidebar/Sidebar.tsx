import { Plus, GitBranch, Folder, Trash2, CheckCircle, Archive, Clock } from 'lucide-react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useProjectStore, type Worktree } from '../../stores/project.store';
import { useTerminalStore } from '../../stores/terminal.store';
import { OrchestratorPanel } from '../orchestrator/OrchestratorPanel';
import { OrchestratorLoopControl } from '../OrchestratorLoopControl';

interface SidebarProps {
  onOpenProject: () => void;
  onCreateWorktree: () => void;
  onDeleteWorktree: (worktreeId: string) => void;
  onArchiveWorktree: (worktreeId: string) => void;
}

export function Sidebar({ onOpenProject, onCreateWorktree, onDeleteWorktree, onArchiveWorktree }: SidebarProps) {
  const { projects, activeProjectId, worktrees, activeWorktreeId, setActiveWorktree } = useProjectStore();
  const { sessions } = useTerminalStore();

  const activeProject = projects.find(p => p.id === activeProjectId);

  // Check if a worktree has any active terminal sessions
  const hasActiveSession = (worktreeId: string) => {
    return Array.from(sessions.values()).some(
      s => s.worktreeId === worktreeId && s.isConnected
    );
  };

  // Sort worktrees by most recent activity: 1) lastCommitDate, 2) createdAt
  // Main worktree always appears first, archived worktrees last
  // Worktrees with active sessions appear before those without
  const sortedWorktrees = [...worktrees].sort((a, b) => {
    // Main worktree always first
    if (a.isMain && !b.isMain) return -1;
    if (!a.isMain && b.isMain) return 1;

    // Archived worktrees always last
    if (a.archived && !b.archived) return 1;
    if (!a.archived && b.archived) return -1;

    // Worktrees with active sessions come first
    const aHasSession = hasActiveSession(a.id);
    const bHasSession = hasActiveSession(b.id);
    if (aHasSession && !bHasSession) return -1;
    if (!aHasSession && bHasSession) return 1;

    // Sort by most recent commit date (descending - newest first)
    const aCommitDate = a.lastCommitDate ? new Date(a.lastCommitDate).getTime() : 0;
    const bCommitDate = b.lastCommitDate ? new Date(b.lastCommitDate).getTime() : 0;
    if (aCommitDate !== bCommitDate) {
      return bCommitDate - aCommitDate;
    }

    // Then by creation date (descending - newest first)
    const aCreatedAt = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bCreatedAt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bCreatedAt - aCreatedAt;
  });

  // Check if a worktree has any rate-limited sessions
  const isWorktreeRateLimited = (worktreeId: string) => {
    return Array.from(sessions.values()).some(
      s => s.worktreeId === worktreeId && s.rateLimit?.isLimited
    );
  };

  const getStatusIndicator = (worktree: Worktree) => {
    const { modified, staged, untracked, ahead, behind } = worktree.status;
    const hasChanges = modified > 0 || staged > 0 || untracked > 0;

    if (hasChanges) {
      return <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title={`${modified} modified, ${staged} staged, ${untracked} untracked`} />;
    }
    if (ahead > 0 || behind > 0) {
      return <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">{ahead > 0 && `↑${ahead}`}{behind > 0 && `↓${behind}`}</span>;
    }
    return <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Clean" />;
  };

  const worktreesContent = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Worktrees header */}
      <div className="px-3 py-2.5 border-b border-zinc-200 dark:border-neutral-700 flex items-center justify-between flex-shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Worktrees</h2>
        <button
          onClick={onCreateWorktree}
          disabled={!activeProjectId}
          className="p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-neutral-700 rounded-md disabled:opacity-40 transition-colors"
          title="New Worktree"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Worktrees list */}
      <div className="flex-1 overflow-y-auto p-2">
        {!activeProjectId ? (
          <div className="text-center py-8 text-zinc-400 dark:text-zinc-500 animate-fade-in">
            <Folder size={28} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">No project selected</p>
            <button
              onClick={onOpenProject}
              className="mt-3 text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 text-sm font-medium transition-colors"
            >
              Open a project
            </button>
          </div>
        ) : sortedWorktrees.length === 0 ? (
          <div className="text-center py-8 text-zinc-400 dark:text-zinc-500 animate-fade-in">
            <GitBranch size={28} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">No worktrees</p>
            <button
              onClick={onCreateWorktree}
              className="mt-3 text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 text-sm font-medium transition-colors"
            >
              Create a worktree
            </button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {sortedWorktrees.map((worktree) => {
              const rateLimited = isWorktreeRateLimited(worktree.id);
              return (
              <button
                key={worktree.id}
                onClick={() => setActiveWorktree(worktree.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left group transition-colors ${
                  activeWorktreeId === worktree.id
                    ? 'bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300'
                    : 'hover:bg-zinc-100 dark:hover:bg-neutral-700/50'
                } ${worktree.archived ? 'opacity-40' : worktree.merged ? 'opacity-60' : ''} ${rateLimited ? 'ring-1 ring-amber-500/30' : ''}`}
              >
                {worktree.archived ? (
                  <Archive size={13} className="text-zinc-400 flex-shrink-0" />
                ) : worktree.merged ? (
                  <CheckCircle size={13} className="text-emerald-500 flex-shrink-0" />
                ) : rateLimited ? (
                  <Clock size={13} className="text-amber-500 animate-pulse flex-shrink-0" />
                ) : (
                  <GitBranch size={13} className={activeWorktreeId === worktree.id ? 'text-blue-500 dark:text-blue-400' : 'text-zinc-400 dark:text-zinc-500'} style={{ flexShrink: 0 }} />
                )}
                <span className={`flex-1 truncate text-[13px] ${worktree.archived || worktree.merged ? 'text-zinc-400 dark:text-zinc-500' : ''}`}>
                  {worktree.branch}
                  {worktree.isMain && <span className="text-zinc-400 dark:text-zinc-500 ml-1 text-xs">(main)</span>}
                  {worktree.archived && <span className="text-zinc-400 ml-1 text-xs">(archived)</span>}
                  {!worktree.archived && worktree.merged && <span className="text-emerald-500 ml-1 text-xs">(merged)</span>}
                  {rateLimited && <span className="text-amber-500 ml-1 text-xs">(paused)</span>}
                </span>
                {!worktree.archived && !worktree.merged && !rateLimited && getStatusIndicator(worktree)}
                {!worktree.isMain && !worktree.archived && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchiveWorktree(worktree.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 dark:text-zinc-500 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-500/10 rounded transition-all"
                    title="Archive worktree (close session)"
                  >
                    <Archive size={11} />
                  </button>
                )}
                {!worktree.isMain && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteWorktree(worktree.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                    title="Delete worktree"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </button>
            );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <aside className="h-full bg-zinc-50 dark:bg-neutral-800/50 border-r border-zinc-200 dark:border-neutral-700 flex flex-col overflow-hidden">
      {activeProjectId && activeProject ? (
        <Group orientation="vertical" className="h-full">
          {/* Orchestrator chat panel - resizable */}
          <Panel defaultSize={40} minSize={5}>
            <div className="h-full p-2 flex flex-col gap-2">
              <OrchestratorLoopControl projectId={activeProjectId} />
              <div className="flex-1 min-h-0">
                <OrchestratorPanel projectId={activeProjectId} projectPath={activeProject.path} />
              </div>
            </div>
          </Panel>

          <Separator className="h-px bg-zinc-200 dark:bg-neutral-700 hover:bg-blue-400 dark:hover:bg-blue-500 cursor-row-resize transition-colors" />

          {/* Worktrees section */}
          <Panel defaultSize={60} minSize={5}>
            {worktreesContent}
          </Panel>
        </Group>
      ) : (
        <div className="flex-1 overflow-hidden">
          {worktreesContent}
        </div>
      )}
    </aside>
  );
}
