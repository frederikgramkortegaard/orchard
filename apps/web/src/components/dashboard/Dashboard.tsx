import { LayoutDashboard, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useProjectStore } from '../../stores/project.store';
import { CommitsChart } from './CommitsChart';
import { MessagesChart } from './MessagesChart';
import { WorktreesCard } from './WorktreesCard';
import { AgentActivityCard } from './AgentActivityCard';

export function Dashboard() {
  const { activeProjectId, worktrees, projects } = useProjectStore();
  const [refreshKey, setRefreshKey] = useState(0);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const projectWorktrees = worktrees.filter((w) => w.projectId === activeProjectId);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  if (!activeProjectId || !activeProject) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-zinc-50 dark:bg-neutral-900 text-zinc-400 dark:text-zinc-500">
        <LayoutDashboard size={40} className="mb-4 opacity-40" />
        <p className="text-sm">Select a project to view dashboard</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-zinc-50 dark:bg-neutral-900 p-6">
      <div className="max-w-6xl mx-auto animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-blue-500/10 dark:bg-blue-500/20 rounded-xl">
              <LayoutDashboard size={22} className="text-blue-500" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">{activeProject.name}</h1>
              <p className="text-sm text-zinc-400 dark:text-zinc-500 font-mono">{activeProject.path}</p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-white dark:bg-neutral-800 hover:bg-zinc-50 dark:hover:bg-neutral-700 border border-zinc-200 dark:border-neutral-700 rounded-lg shadow-sm transition-all"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6" key={refreshKey}>
          <CommitsChart projectId={activeProjectId} />
          <MessagesChart projectId={activeProjectId} />
        </div>

        {/* Activity Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <WorktreesCard worktrees={projectWorktrees} />
          <AgentActivityCard projectId={activeProjectId} />
        </div>
      </div>
    </div>
  );
}
