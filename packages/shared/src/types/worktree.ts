export interface Worktree {
  id: string;
  projectId: string;
  path: string;           // Absolute path to worktree
  branch: string;
  isMain: boolean;
  isLocked: boolean;
  status: WorktreeStatus;
  terminalSessions: string[];
}

export interface WorktreeStatus {
  ahead: number;
  behind: number;
  modified: number;
  staged: number;
  untracked: number;
}

export interface CreateWorktreeRequest {
  branch: string;
  newBranch?: boolean;    // Create new branch from HEAD
  baseBranch?: string;    // Base branch for new branch
}
