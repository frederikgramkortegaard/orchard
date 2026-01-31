import type { Project, Worktree } from '../stores/project.store';

const API_BASE = '/api';

// Fetch currently open projects
export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/projects`);
  if (!res.ok) throw new Error('Failed to fetch projects');
  return res.json();
}

// Fetch all available projects on disk
export async function fetchAvailableProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/projects/available`);
  if (!res.ok) throw new Error('Failed to fetch available projects');
  return res.json();
}

// Open an existing project
export async function openProject(projectId: string): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/open`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to open project');
  return res.json();
}

// Close a project (don't delete, just stop tracking as open)
export async function closeProject(projectId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/close`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to close project');
}

export async function createProject(data: { repoUrl?: string; localPath?: string; name?: string; inPlace?: boolean }): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create project');
  }
  return res.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${projectId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete project');
}

export async function fetchWorktrees(projectId: string): Promise<Worktree[]> {
  const res = await fetch(`${API_BASE}/worktrees?projectId=${projectId}`);
  if (!res.ok) throw new Error('Failed to fetch worktrees');
  return res.json();
}

export async function createWorktree(data: {
  projectId: string;
  branch: string;
  newBranch?: boolean;
  baseBranch?: string;
}): Promise<Worktree> {
  const res = await fetch(`${API_BASE}/worktrees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create worktree');
  }
  return res.json();
}

export async function deleteWorktree(worktreeId: string, force = false): Promise<void> {
  const res = await fetch(`${API_BASE}/worktrees/${worktreeId}?force=${force}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to delete worktree');
  }
}

export async function fetchBranches(projectId: string): Promise<{ local: string[]; remote: string[]; defaultBranch: string }> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/branches`);
  if (!res.ok) throw new Error('Failed to fetch branches');
  return res.json();
}

export async function markWorktreeMerged(worktreeId: string): Promise<Worktree> {
  const res = await fetch(`${API_BASE}/worktrees/${worktreeId}/mark-merged`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to mark worktree as merged');
  }
  return res.json();
}
