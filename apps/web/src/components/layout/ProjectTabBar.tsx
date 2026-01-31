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
    <div className="flex items-center bg-zinc-900 border-b border-zinc-800 px-1">
      {projects.map((project) => (
        <button
          key={project.id}
          onClick={() => setActiveProject(project.id)}
          className={`group flex items-center gap-2 px-3 py-1.5 border-b-2 transition-colors ${
            activeProjectId === project.id
              ? 'border-blue-500 bg-zinc-800 text-white'
              : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-800/50'
          }`}
        >
          <Folder size={14} />
          <span className="text-sm max-w-32 truncate">{project.name}</span>
          <button
            onClick={(e) => handleCloseTab(e, project.id)}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-zinc-200 transition-opacity"
            title="Close tab (files are kept on disk)"
          >
            <X size={12} />
          </button>
        </button>
      ))}

      <button
        onClick={onNewProject}
        className="flex items-center gap-1 px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors"
        title="Open Project"
      >
        <Plus size={14} />
        <span className="text-sm">New</span>
      </button>
    </div>
  );
}
