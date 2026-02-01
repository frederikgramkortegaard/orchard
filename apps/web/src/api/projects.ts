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

// File conflict types
export interface FileConflict {
  filePath: string;
  worktrees: Array<{
    worktreeId: string;
    branch: string;
    status: 'modified' | 'staged' | 'untracked';
  }>;
}

export interface ConflictsResult {
  projectId: string;
  conflicts: FileConflict[];
  worktreeConflicts: Record<string, string[]>;
  hasConflicts: boolean;
}

// Fetch file conflicts for a project
export async function fetchConflicts(projectId: string): Promise<ConflictsResult> {
  const res = await fetch(`${API_BASE}/files/conflicts?projectId=${projectId}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch conflicts');
  }
  return res.json();
}

// Fetch worktrees with conflict information
export async function fetchWorktreesWithConflicts(projectId: string): Promise<Worktree[]> {
  const [worktrees, conflictsResult] = await Promise.all([
    fetchWorktrees(projectId),
    fetchConflicts(projectId).catch(() => ({ worktreeConflicts: {} } as ConflictsResult)),
  ]);

  // Merge conflict information into worktrees
  return worktrees.map(wt => ({
    ...wt,
    conflictingFiles: conflictsResult.worktreeConflicts[wt.id] || [],
  }));
}

// Git History types
export interface GitCommitInfo {
  hash: string;
  hashShort: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  parents: string[];
  refs: string[];
}

export interface GitGraphNode {
  commit: GitCommitInfo;
  column: number;
  isMerge: boolean;
  branchColor: number;
}

export interface GitHistoryResult {
  worktreeId: string;
  currentBranch: string;
  commits: GitGraphNode[];
  branches: { name: string; head: string; isCurrent: boolean }[];
}

export interface CommitFilesResult {
  worktreeId: string;
  commitHash: string;
  files: {
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
  }[];
}

export interface CommitDetailResult {
  worktreeId: string;
  commit: GitCommitInfo;
  files: {
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
  }[];
  diff: string;
}

export interface CommitTreeEntry {
  mode: string;
  type: 'blob' | 'tree';
  hash: string;
  size: number | null;
  name: string;
  path: string;
}

export interface CommitTreeResult {
  worktreeId: string;
  commitHash: string;
  path: string;
  entries: CommitTreeEntry[];
}

export interface CommitFileContentResult {
  worktreeId: string;
  commitHash: string;
  path: string;
  content: string;
}

export interface CommitCompareResult {
  worktreeId: string;
  base: string;
  target: string;
  diff: string;
}

// Fetch git history with graph information
export async function fetchGitHistory(
  worktreeId: string,
  limit = 100,
  skip = 0
): Promise<GitHistoryResult> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    skip: skip.toString(),
  });
  const res = await fetch(`${API_BASE}/worktrees/${worktreeId}/history?${params}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch git history');
  }
  return res.json();
}

// Fetch files changed in a specific commit
export async function fetchCommitFiles(
  worktreeId: string,
  commitHash: string
): Promise<CommitFilesResult> {
  const res = await fetch(`${API_BASE}/worktrees/${worktreeId}/commits/${commitHash}/files`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch commit files');
  }
  return res.json();
}

// Fetch detailed commit information including diff
export async function fetchCommitDetail(
  worktreeId: string,
  commitHash: string
): Promise<CommitDetailResult> {
  const res = await fetch(`${API_BASE}/worktrees/${worktreeId}/commits/${commitHash}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch commit details');
  }
  return res.json();
}

// Compare two commits
export async function fetchCommitCompare(
  worktreeId: string,
  base: string,
  target: string
): Promise<CommitCompareResult> {
  const params = new URLSearchParams({ base, target });
  const res = await fetch(`${API_BASE}/worktrees/${worktreeId}/compare?${params}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to compare commits');
  }
  return res.json();
}

// Fetch file tree at a specific commit
export async function fetchCommitTree(
  worktreeId: string,
  commitHash: string,
  path = ''
): Promise<CommitTreeResult> {
  const params = new URLSearchParams();
  if (path) params.append('path', path);
  const res = await fetch(`${API_BASE}/worktrees/${worktreeId}/commits/${commitHash}/tree?${params}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch commit tree');
  }
  return res.json();
}

// Fetch file content at a specific commit
export async function fetchCommitFileContent(
  worktreeId: string,
  commitHash: string,
  path: string
): Promise<CommitFileContentResult> {
  const params = new URLSearchParams({ path });
  const res = await fetch(`${API_BASE}/worktrees/${worktreeId}/commits/${commitHash}/file?${params}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch file content');
  }
  return res.json();
}

// Alias for backward compatibility
export type GitHistoryCommit = GitGraphNode;

// Fetch worktree history (alias for fetchGitHistory)
export async function fetchWorktreeHistory(
  worktreeId: string,
  limit = 100
): Promise<GitHistoryResult> {
  return fetchGitHistory(worktreeId, limit);
}

// Fetch project-wide history (all branches)
export async function fetchProjectHistory(
  projectId: string,
  limit = 100
): Promise<GitHistoryResult> {
  const params = new URLSearchParams({
    limit: limit.toString(),
  });
  const res = await fetch(`${API_BASE}/projects/${projectId}/history?${params}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch project history');
  }
  return res.json();
}
