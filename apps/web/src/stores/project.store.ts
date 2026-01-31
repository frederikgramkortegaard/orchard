import { create } from 'zustand';

export interface Project {
  id: string;
  name: string;
  path: string;
  repoUrl?: string;
  createdAt: string;
}

export interface Worktree {
  id: string;
  projectId: string;
  path: string;
  branch: string;
  isMain: boolean;
  status: {
    ahead: number;
    behind: number;
    modified: number;
    staged: number;
    untracked: number;
  };
}

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  worktrees: Worktree[];
  activeWorktreeId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setProjects: (projects: Project[]) => void;
  setActiveProject: (projectId: string | null) => void;
  addProject: (project: Project) => void;
  removeProject: (projectId: string) => void;  // Called after deleting from disk
  closeProject: (projectId: string) => void;   // Just close tab, keep files
  setWorktrees: (worktrees: Worktree[]) => void;
  setActiveWorktree: (worktreeId: string | null) => void;
  addWorktree: (worktree: Worktree) => void;
  removeWorktree: (worktreeId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  activeProjectId: null,
  worktrees: [],
  activeWorktreeId: null,
  isLoading: false,
  error: null,

  setProjects: (projects) => set({ projects }),
  setActiveProject: (projectId) => set({ activeProjectId: projectId }),
  addProject: (project) => set((state) => {
    // Check if already exists (by id or path)
    const exists = state.projects.some(p => p.id === project.id || p.path === project.path);
    if (exists) {
      // Just activate the existing one
      const existingProject = state.projects.find(p => p.id === project.id || p.path === project.path);
      return { activeProjectId: existingProject?.id || project.id };
    }
    return {
      projects: [...state.projects, project],
      activeProjectId: project.id,
    };
  }),
  removeProject: (projectId) => set((state) => ({
    projects: state.projects.filter(p => p.id !== projectId),
    activeProjectId: state.activeProjectId === projectId ? null : state.activeProjectId,
    worktrees: state.worktrees.filter(w => w.projectId !== projectId),
    activeWorktreeId: state.worktrees.some(w => w.id === state.activeWorktreeId && w.projectId === projectId)
      ? null : state.activeWorktreeId,
  })),
  closeProject: (projectId) => set((state) => {
    // Just close the tab - remove from UI but don't touch files
    const remaining = state.projects.filter(p => p.id !== projectId);
    const newActiveId = state.activeProjectId === projectId
      ? (remaining.length > 0 ? remaining[0].id : null)
      : state.activeProjectId;
    return {
      projects: remaining,
      activeProjectId: newActiveId,
      worktrees: state.worktrees.filter(w => w.projectId !== projectId),
      activeWorktreeId: state.worktrees.some(w => w.id === state.activeWorktreeId && w.projectId === projectId)
        ? null : state.activeWorktreeId,
    };
  }),
  setWorktrees: (worktrees) => set({ worktrees }),
  setActiveWorktree: (worktreeId) => set({ activeWorktreeId: worktreeId }),
  addWorktree: (worktree) => set((state) => ({
    worktrees: [...state.worktrees, worktree],
    activeWorktreeId: worktree.id,
  })),
  removeWorktree: (worktreeId) => set((state) => ({
    worktrees: state.worktrees.filter(w => w.id !== worktreeId),
    activeWorktreeId: state.activeWorktreeId === worktreeId ? null : state.activeWorktreeId,
  })),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
