import { useState, useEffect, useCallback } from 'react';
import { Plus, GitBranch, Folder, Trash2, Archive, Clock, GitCompare, GitMerge, Loader2, Search, X, Copy } from 'lucide-react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useProjectStore, type Worktree } from '../../stores/project.store';
import { useTerminalStore } from '../../stores/terminal.store';
import { useToast } from '../../contexts/ToastContext';
import { SplitTerminalPane } from '../terminal/SplitTerminalPane';
import { FileViewer } from './FileViewer';

interface SidebarProps {
  onOpenProject: () => void;
  onCreateWorktree: () => void;
  onDeleteWorktree: (worktreeId: string) => void;
  onArchiveWorktree: (worktreeId: string) => void;
  onViewDiff: (worktreeId: string, branch: string) => void;
  worktreeId?: string;
  worktreePath?: string;
  projectPath?: string;
}

interface ContextMenu {
  x: number;
  y: number;
  worktree: Worktree;
}

export function Sidebar({ onOpenProject, onCreateWorktree, onDeleteWorktree, onArchiveWorktree, onViewDiff, worktreeId, worktreePath, projectPath }: SidebarProps) {
  const { projects, activeProjectId, worktrees, activeWorktreeId, setActiveWorktree, fetchWorktrees } = useProjectStore();
  const { sessions } = useTerminalStore();
  const { addToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [mergingWorktreeId, setMergingWorktreeId] = useState<string | null>(null);

  const handleMerge = async (worktreeId: string, branch: string) => {
    setMergingWorktreeId(worktreeId);
    try {
      const response = await fetch(`/api/worktrees/${worktreeId}/merge`, {
        method: 'POST',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Merge failed');
      }
      addToast('success', `Merged ${branch} into main`);
      if (activeProjectId) {
        fetchWorktrees(activeProjectId);
      }
    } catch (error) {
      addToast('error', `Failed to merge: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setMergingWorktreeId(null);
    }
  };

  // Close context menu when clicking outside
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (contextMenu) {
      const handleClick = () => closeContextMenu();
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeContextMenu();
      };
      document.addEventListener('click', handleClick);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('click', handleClick);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [contextMenu, closeContextMenu]);

  const handleContextMenu = (e: React.MouseEvent, worktree: Worktree) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, worktree });
  };

  const handleCopyBranchName = () => {
    if (contextMenu) {
      navigator.clipboard.writeText(contextMenu.worktree.branch);
      addToast('success', `Copied "${contextMenu.worktree.branch}" to clipboard`);
      closeContextMenu();
    }
  };

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

  // Filter worktrees by search query
  const filteredWorktrees = sortedWorktrees.filter(worktree =>
    worktree.branch.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

      {/* Search input */}
      {activeProjectId && worktrees.length > 0 && (
        <div className="px-2 py-2 border-b border-zinc-300 dark:border-zinc-700 flex-shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setSearchQuery('')}
              placeholder="Filter branches..."
              className="w-full pl-7 pr-7 py-1 text-sm bg-zinc-200 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

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
        ) : sortedWorktrees.length === 0 ? (
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
        ) : filteredWorktrees.length === 0 ? (
          <div className="text-center py-4 text-zinc-500">
            <p className="text-sm">No matching branches</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredWorktrees.map((worktree) => {
              const rateLimited = isWorktreeRateLimited(worktree.id);
              return (
              <div
                key={worktree.id}
                onClick={() => setActiveWorktree(activeWorktreeId === worktree.id ? null : worktree.id)}
                onContextMenu={(e) => handleContextMenu(e, worktree)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left group cursor-pointer transition-all ${
                  activeWorktreeId === worktree.id
                    ? 'bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-300 dark:ring-blue-700'
                    : 'bg-zinc-200/50 dark:bg-zinc-700/50 hover:bg-zinc-300/70 dark:hover:bg-zinc-600/70'
                } ${worktree.archived ? 'opacity-40' : ''} ${rateLimited ? 'ring-1 ring-amber-500/50' : ''}`}
              >
                {worktree.archived ? (
                  <Archive size={14} className="text-zinc-400 flex-shrink-0" />
                ) : rateLimited ? (
                  <Clock size={14} className="text-amber-500 animate-pulse flex-shrink-0" />
                ) : hasActiveSession(worktree.id) ? (
                  <Loader2 size={14} className="text-blue-500 animate-spin flex-shrink-0" />
                ) : (
                  <GitBranch size={14} className="text-zinc-500 dark:text-zinc-400 flex-shrink-0" />
                )}
                <span className={`flex-1 truncate text-sm ${worktree.archived ? 'text-zinc-400 dark:text-zinc-500' : ''}`}>
                  {worktree.branch}
                  {worktree.isMain && <span className="text-zinc-400 dark:text-zinc-500 ml-1">(main)</span>}
                  {worktree.archived && <span className="text-zinc-400 ml-1">(archived)</span>}
                  {rateLimited && <span className="text-amber-500 ml-1">(paused)</span>}
                </span>
                {!worktree.archived && !rateLimited && getStatusIndicator(worktree)}
                {!worktree.archived && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewDiff(worktree.id, worktree.branch);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-500 dark:text-zinc-400 hover:text-blue-500 dark:hover:text-blue-400"
                    title="View diff"
                  >
                    <GitCompare size={12} />
                  </button>
                )}
                {!worktree.isMain && !worktree.archived && worktree.status.ahead > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMerge(worktree.id, worktree.branch);
                    }}
                    disabled={mergingWorktreeId === worktree.id}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-500 dark:text-zinc-400 hover:text-green-500 dark:hover:text-green-400 disabled:opacity-50"
                    title="Merge into main"
                  >
                    {mergingWorktreeId === worktree.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <GitMerge size={12} />
                    )}
                  </button>
                )}
                {!worktree.isMain && !worktree.archived && (
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
              </div>
            );
            })}
          </div>
        )}
      </div>

      {/* File Viewer */}
      <FileViewer worktreePath={worktrees.find(w => w.id === activeWorktreeId)?.path} />
    </div>
  );

  return (
    <aside className="h-full bg-zinc-100 dark:bg-zinc-800 border-r border-zinc-300 dark:border-zinc-700 flex flex-col overflow-hidden">
      {activeProjectId && activeProject ? (
        worktreeId ? (
          // Show terminal + worktrees when a worktree is selected
          <Group orientation="vertical" className="h-full">
            {/* Terminal panel - top */}
            <Panel defaultSize={60} minSize={5}>
              <SplitTerminalPane
                worktreeId={worktreeId}
                worktreePath={worktreePath}
                projectPath={projectPath}
              />
            </Panel>

            <Separator className="h-1 bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600 cursor-row-resize" />

            {/* Worktrees section - bottom */}
            <Panel defaultSize={40} minSize={5}>
              {worktreesContent}
            </Panel>
          </Group>
        ) : (
          // Only show worktrees when no worktree is selected
          <div className="flex-1 overflow-hidden">
            {worktreesContent}
          </div>
        )
      ) : (
        <div className="flex-1 overflow-hidden">
          {worktreesContent}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {!contextMenu.worktree.archived && (
            <button
              onClick={() => {
                onViewDiff(contextMenu.worktree.id, contextMenu.worktree.branch);
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left"
            >
              <GitCompare size={14} />
              View Diff
            </button>
          )}
          <button
            onClick={handleCopyBranchName}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left"
          >
            <Copy size={14} />
            Copy Branch Name
          </button>
          {!contextMenu.worktree.isMain && !contextMenu.worktree.archived && (
            <>
              <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
              <button
                onClick={() => {
                  onArchiveWorktree(contextMenu.worktree.id);
                  closeContextMenu();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-amber-600 dark:text-amber-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left"
              >
                <Archive size={14} />
                Archive
              </button>
            </>
          )}
          {!contextMenu.worktree.isMain && (
            <button
              onClick={() => {
                onDeleteWorktree(contextMenu.worktree.id);
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left"
            >
              <Trash2 size={14} />
              Delete
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
