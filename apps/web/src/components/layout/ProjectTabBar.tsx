import { Plus, X, Folder, Settings, Bug, Sun, Moon } from 'lucide-react';
import { useProjectStore, Project } from '../../stores/project.store';
import { useTheme } from '../../contexts/ThemeContext';
import * as api from '../../api/projects';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ProjectTabBarProps {
  onNewProject: () => void;
  onProjectSwitch?: (projectId: string) => void;
  onOpenSettings?: () => void;
  onOpenDebug?: () => void;
}

interface SortableTabProps {
  project: Project;
  isActive: boolean;
  onProjectClick: (projectId: string) => void;
  onCloseTab: (e: React.MouseEvent, projectId: string) => void;
}

function SortableTab({ project, isActive, onProjectClick, onCloseTab }: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onProjectClick(project.id)}
      className={`group flex items-center gap-1.5 px-3 py-1 rounded-md transition-all cursor-grab active:cursor-grabbing ${
        isActive
          ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-700'
          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50'
      }`}
    >
      <Folder size={13} className={isActive ? 'text-green-500' : ''} />
      <span className="text-xs font-medium max-w-28 truncate">{project.name}</span>
      <button
        onClick={(e) => onCloseTab(e, project.id)}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-opacity"
        title="Close tab (files are kept on disk)"
      >
        <X size={11} />
      </button>
    </div>
  );
}

export function ProjectTabBar({ onNewProject, onProjectSwitch, onOpenSettings, onOpenDebug }: ProjectTabBarProps) {
  const { projects, activeProjectId, setActiveProject, closeProject, reorderProjects } = useProjectStore();
  const { theme, toggleTheme } = useTheme();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleProjectClick = (projectId: string) => {
    if (projectId !== activeProjectId) {
      setActiveProject(projectId);
      onProjectSwitch?.(projectId);
    }
  };

  const handleCloseTab = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    try {
      await api.closeProject(projectId);
    } catch (err) {
      console.error('Failed to close project:', err);
    }
    closeProject(projectId);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      reorderProjects(active.id as string, over.id as string);
    }
  };

  return (
    <div className="flex items-center h-9 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-2 gap-1">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={projects.map(p => p.id)}
          strategy={horizontalListSortingStrategy}
        >
          {projects.map((project) => (
            <SortableTab
              key={project.id}
              project={project}
              isActive={activeProjectId === project.id}
              onProjectClick={handleProjectClick}
              onCloseTab={handleCloseTab}
            />
          ))}
        </SortableContext>
      </DndContext>

      <button
        onClick={onNewProject}
        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-colors"
        title="Open Project"
      >
        <Plus size={13} />
        <span className="text-xs">New</span>
      </button>

      <div className="flex-1" />

      <button
        onClick={toggleTheme}
        className="p-1.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-colors"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>

      {onOpenDebug && (
        <button
          onClick={onOpenDebug}
          className="p-1.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-colors"
          title="Debug Panel"
        >
          <Bug size={14} />
        </button>
      )}

      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-colors"
          title="Settings"
        >
          <Settings size={14} />
        </button>
      )}
    </div>
  );
}
