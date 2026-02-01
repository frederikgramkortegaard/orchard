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

// Archive a worktree - close its terminal sessions
export async function archiveWorktree(worktreeId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/worktrees/${worktreeId}/archive`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to archive worktree');
  }
}

// Diff types
export type DiffType = 'working' | 'staged' | 'branch' | 'commit';

export interface DiffResult {
  worktreeId: string;
  branch: string;
  type: DiffType;
  base: string | null;
  target: string | null;
  diff: string;
}

export interface Commit {
  hash: string;
  hashShort: string;
  message: string;
  author: string;
  date: string;
}

export interface CommitsResult {
  worktreeId: string;
  commits: Commit[];
}

export interface BranchesResult {
  worktreeId: string;
  currentBranch: string;
  branches: string[];
}

// Get diff for a worktree
export async function fetchDiff(
  worktreeId: string,
  type: DiffType = 'working',
  base?: string,
  target?: string
): Promise<DiffResult> {
  const params = new URLSearchParams({ type });
  if (base) params.append('base', base);
  if (target) params.append('target', target);

  const res = await fetch(`${API_BASE}/worktrees/${worktreeId}/diff?${params}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch diff');
  }
  return res.json();
}

// Get commits for a worktree
export async function fetchCommits(worktreeId: string, limit = 50): Promise<CommitsResult> {
  const res = await fetch(`${API_BASE}/worktrees/${worktreeId}/commits?limit=${limit}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch commits');
  }
  return res.json();
}

// Get branches for a worktree
export async function fetchWorktreeBranches(worktreeId: string): Promise<BranchesResult> {
  const res = await fetch(`${API_BASE}/worktrees/${worktreeId}/branches`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch branches');
  }
  return res.json();
}
