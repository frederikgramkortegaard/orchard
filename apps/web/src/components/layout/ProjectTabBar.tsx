import { Plus, X, Folder, LayoutDashboard } from 'lucide-react';
import { useProjectStore } from '../../stores/project.store';
import * as api from '../../api/projects';

interface ProjectTabBarProps {
  onNewProject: () => void;
  showDashboard?: boolean;
  onToggleDashboard?: () => void;
  onProjectSwitch?: (projectId: string) => void;
}

export function ProjectTabBar({ onNewProject, showDashboard, onToggleDashboard, onProjectSwitch }: ProjectTabBarProps) {
  const { projects, activeProjectId, setActiveProject, closeProject } = useProjectStore();

  const handleProjectClick = (projectId: string) => {
    if (projectId !== activeProjectId) {
      setActiveProject(projectId);
      onProjectSwitch?.(projectId);
    }
  };

  const handleCloseTab = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    // Just close the tab - don't delete any files!
    try {
      await api.closeProject(projectId);
    } catch (err) {
      console.error('Failed to close project:', err);
    }
    closeProject(projectId);
  };

  return (
    <div className="flex items-center h-9 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-2 gap-1">
      {projects.map((project) => (
        <div
          key={project.id}
          onClick={() => handleProjectClick(project.id)}
          className={`group flex items-center gap-1.5 px-3 py-1 rounded-md transition-all cursor-pointer ${
            activeProjectId === project.id
              ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-700'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50'
          }`}
        >
          <Folder size={13} className={activeProjectId === project.id ? 'text-emerald-500' : ''} />
          <span className="text-xs font-medium max-w-28 truncate">{project.name}</span>
          <button
            onClick={(e) => handleCloseTab(e, project.id)}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-opacity"
            title="Close tab (files are kept on disk)"
          >
            <X size={11} />
          </button>
        </div>
      ))}

      <button
        onClick={onNewProject}
        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-colors"
        title="Open Project"
      >
        <Plus size={13} />
        <span className="text-xs">New</span>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Dashboard toggle */}
      {onToggleDashboard && (
        <button
          onClick={onToggleDashboard}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
            showDashboard
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20'
              : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50'
          }`}
          title={showDashboard ? 'Hide Dashboard' : 'Show Dashboard'}
        >
          <LayoutDashboard size={13} />
          <span className="text-xs font-medium">Dashboard</span>
        </button>
      )}
    </div>
  );
}
