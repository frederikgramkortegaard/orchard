import { Plus, X, Folder, LayoutDashboard } from 'lucide-react';
import { useProjectStore, Project } from '../../stores/project.store';
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
  showDashboard?: boolean;
  onToggleDashboard?: () => void;
  onProjectSwitch?: (projectId: string) => void;
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

export function ProjectTabBar({ onNewProject, showDashboard, onToggleDashboard, onProjectSwitch }: ProjectTabBarProps) {
  const { projects, activeProjectId, setActiveProject, closeProject, reorderProjects } = useProjectStore();

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
    // Just close the tab - don't delete any files!
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

      {/* Spacer */}
      <div className="flex-1" />

      {/* Dashboard toggle */}
      {onToggleDashboard && (
        <button
          onClick={onToggleDashboard}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
            showDashboard
              ? 'bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20'
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
