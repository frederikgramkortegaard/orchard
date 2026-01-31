import { useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Plus, GitBranch, Folder, Trash2, Bot, PanelTopClose, PanelTop } from 'lucide-react';
import { useProjectStore, type Worktree } from '../../stores/project.store';
import { OrchestratorPanel } from '../orchestrator/OrchestratorPanel';

interface SidebarProps {
  onOpenProject: () => void;
  onCreateWorktree: () => void;
  onDeleteWorktree: (worktreeId: string) => void;
}

export function Sidebar({ onOpenProject, onCreateWorktree, onDeleteWorktree }: SidebarProps) {
  const { projects, activeProjectId, worktrees, activeWorktreeId, setActiveWorktree } = useProjectStore();
  const [showOrchestrator, setShowOrchestrator] = useState(true);

  const activeProject = projects.find(p => p.id === activeProjectId);

  const getStatusIndicator = (worktree: Worktree) => {
    const { modified, staged, untracked, ahead, behind } = worktree.status;
    const hasChanges = modified > 0 || staged > 0 || untracked > 0;

    if (hasChanges) {
      return <span className="w-2 h-2 rounded-full bg-yellow-500" title={`${modified} modified, ${staged} staged, ${untracked} untracked`} />;
    }
    if (ahead > 0 || behind > 0) {
      return <span className="text-xs text-zinc-500">{ahead > 0 && `↑${ahead}`}{behind > 0 && `↓${behind}`}</span>;
    }
    return <span className="w-2 h-2 rounded-full bg-green-500" title="Clean" />;
  };

  const worktreesContent = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Worktrees header */}
      <div className="px-4 py-3 border-b border-zinc-700 flex items-center justify-between flex-shrink-0">
        <h2 className="text-sm font-semibold text-zinc-400">WORKTREES</h2>
        <button
          onClick={onCreateWorktree}
          disabled={!activeProjectId}
          className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded disabled:opacity-50"
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
              className="mt-2 text-blue-400 hover:text-blue-300 text-sm"
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
              className="mt-2 text-blue-400 hover:text-blue-300 text-sm"
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
                  activeWorktreeId === worktree.id ? 'bg-zinc-600' : 'hover:bg-zinc-700/50'
                }`}
              >
                <GitBranch size={14} className="text-zinc-400 flex-shrink-0" />
                <span className="flex-1 truncate text-sm">
                  {worktree.branch}
                  {worktree.isMain && <span className="text-zinc-500 ml-1">(main)</span>}
                </span>
                {getStatusIndicator(worktree)}
                {!worktree.isMain && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteWorktree(worktree.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-red-400"
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
    <aside className="h-full bg-zinc-800 border-r border-zinc-700 flex flex-col overflow-hidden">
      {/* Toggle orchestrator button */}
      {activeProjectId && activeProject && (
        <div className="px-2 py-1.5 border-b border-zinc-700 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-zinc-400">
            <Bot size={14} />
            <span className="text-xs font-medium">Orchestrator</span>
          </div>
          <button
            onClick={() => setShowOrchestrator(!showOrchestrator)}
            className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded"
            title={showOrchestrator ? 'Hide Orchestrator' : 'Show Orchestrator'}
          >
            {showOrchestrator ? <PanelTopClose size={14} /> : <PanelTop size={14} />}
          </button>
        </div>
      )}

      {/* Main content with resizable panels */}
      {activeProjectId && activeProject && showOrchestrator ? (
        <Group orientation="vertical" className="flex-1 overflow-hidden">
          {/* Orchestrator panel - resizable */}
          <Panel defaultSize={50} minSize={25} maxSize={75}>
            <div className="h-full p-2 overflow-hidden">
              <OrchestratorPanel projectId={activeProjectId} projectPath={activeProject.path} />
            </div>
          </Panel>

          <Separator className="h-1 bg-zinc-700 hover:bg-zinc-600 cursor-row-resize flex-shrink-0" />

          {/* Worktrees section */}
          <Panel defaultSize={50} minSize={25}>
            {worktreesContent}
          </Panel>
        </Group>
      ) : (
        /* Just worktrees when orchestrator is hidden or no project */
        <div className="flex-1 overflow-hidden">
          {worktreesContent}
        </div>
      )}
    </aside>
  );
}
