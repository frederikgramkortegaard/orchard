export type AgentMode = 'normal' | 'plan';

export interface Worktree {
  id: string;
  projectId: string;
  path: string;           // Absolute path to worktree
  branch: string;
  isMain: boolean;
  isLocked: boolean;
  merged: boolean;        // True if worktree branch has been merged
  mode?: AgentMode;       // Agent execution mode (normal or plan)
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
