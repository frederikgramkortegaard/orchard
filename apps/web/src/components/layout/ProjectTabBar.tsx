import { Plus, X, Folder } from 'lucide-react';
import { useProjectStore } from '../../stores/project.store';
import * as api from '../../api/projects';

interface ProjectTabBarProps {
  onNewProject: () => void;
}

export function ProjectTabBar({ onNewProject }: ProjectTabBarProps) {
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
    <div className="flex items-center bg-zinc-50 dark:bg-zinc-900 pink:bg-pink-50 border-b border-zinc-200 dark:border-zinc-800 pink:border-pink-200 px-1">
      {projects.map((project) => (
        <button
          key={project.id}
          onClick={() => setActiveProject(project.id)}
          className={`group flex items-center gap-2 px-3 py-1.5 border-b-2 transition-colors ${
            activeProjectId === project.id
              ? 'border-blue-500 pink:border-pink-500 bg-zinc-200 dark:bg-zinc-800 pink:bg-pink-200 text-zinc-900 dark:text-white pink:text-pink-900'
              : 'border-transparent text-zinc-500 dark:text-zinc-400 pink:text-pink-500 hover:text-zinc-900 dark:hover:text-white pink:hover:text-pink-900 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 pink:hover:bg-pink-200/50'
          }`}
        >
          <Folder size={14} />
          <span className="text-sm max-w-32 truncate">{project.name}</span>
          <button
            onClick={(e) => handleCloseTab(e, project.id)}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200 pink:hover:text-pink-700 transition-opacity"
            title="Close tab (files are kept on disk)"
          >
            <X size={12} />
          </button>
        </button>
      ))}

      <button
        onClick={onNewProject}
        className="flex items-center gap-1 px-3 py-1.5 text-zinc-500 dark:text-zinc-400 pink:text-pink-500 hover:text-zinc-900 dark:hover:text-white pink:hover:text-pink-900 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 pink:hover:bg-pink-200/50 transition-colors"
        title="Open Project"
      >
        <Plus size={14} />
        <span className="text-sm">New</span>
      </button>
    </div>
  );
}
