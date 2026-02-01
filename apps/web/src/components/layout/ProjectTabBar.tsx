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
    <div className="flex items-center bg-white dark:bg-neutral-900 border-b border-zinc-200 dark:border-neutral-800 px-1 h-9">
      {projects.map((project) => (
        <button
          key={project.id}
          onClick={() => setActiveProject(project.id)}
          className={`group flex items-center gap-2 px-3 h-full border-b-2 transition-all ${
            activeProjectId === project.id
              ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-500/10 text-zinc-900 dark:text-white'
              : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-neutral-800'
          }`}
        >
          <Folder size={13} className={activeProjectId === project.id ? 'text-blue-500' : ''} />
          <span className="text-[13px] max-w-32 truncate">{project.name}</span>
          <button
            onClick={(e) => handleCloseTab(e, project.id)}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-neutral-700 rounded transition-all"
            title="Close tab (files are kept on disk)"
          >
            <X size={11} />
          </button>
        </button>
      ))}

      <button
        onClick={onNewProject}
        className="flex items-center gap-1.5 px-3 h-full text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-neutral-800 transition-colors"
        title="Open Project"
      >
        <Plus size={13} />
        <span className="text-[13px]">New</span>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Dashboard toggle */}
      {onToggleDashboard && (
        <button
          onClick={onToggleDashboard}
          className={`flex items-center gap-1.5 px-3 h-full transition-colors ${
            showDashboard
              ? 'text-blue-500 bg-blue-50 dark:bg-blue-500/10'
              : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-neutral-800'
          }`}
          title={showDashboard ? 'Hide Dashboard' : 'Show Dashboard'}
        >
          <LayoutDashboard size={13} />
          <span className="text-[13px]">Dashboard</span>
        </button>
      )}
    </div>
  );
}
