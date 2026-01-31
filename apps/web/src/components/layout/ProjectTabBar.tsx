import { Plus, X, Folder, LayoutDashboard } from 'lucide-react';
import { useProjectStore } from '../../stores/project.store';
import * as api from '../../api/projects';

interface ProjectTabBarProps {
  onNewProject: () => void;
  showDashboard?: boolean;
  onToggleDashboard?: () => void;
}

export function ProjectTabBar({ onNewProject, showDashboard, onToggleDashboard }: ProjectTabBarProps) {
  const { projects, activeProjectId, setActiveProject, closeProject } = useProjectStore();

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
    <div className="flex items-center bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-1">
      {projects.map((project) => (
        <button
          key={project.id}
          onClick={() => setActiveProject(project.id)}
          className={`group flex items-center gap-2 px-3 py-1.5 border-b-2 transition-colors ${
            activeProjectId === project.id
              ? 'border-blue-500 bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white'
              : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50'
          }`}
        >
          <Folder size={14} />
          <span className="text-sm max-w-32 truncate">{project.name}</span>
          <button
            onClick={(e) => handleCloseTab(e, project.id)}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200 transition-opacity"
            title="Close tab (files are kept on disk)"
          >
            <X size={12} />
          </button>
        </button>
      ))}

      <button
        onClick={onNewProject}
        className="flex items-center gap-1 px-3 py-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-colors"
        title="Open Project"
      >
        <Plus size={14} />
        <span className="text-sm">New</span>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Dashboard toggle */}
      {onToggleDashboard && (
        <button
          onClick={onToggleDashboard}
          className={`flex items-center gap-1 px-3 py-1.5 transition-colors ${
            showDashboard
              ? 'text-blue-500 bg-blue-500/10 hover:bg-blue-500/20'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50'
          }`}
          title={showDashboard ? 'Hide Dashboard' : 'Show Dashboard'}
        >
          <LayoutDashboard size={14} />
          <span className="text-sm">Dashboard</span>
        </button>
      )}
    </div>
  );
}
