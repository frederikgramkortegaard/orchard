export interface TerminalSession {
  id: string;
  worktreeId: string;
  cwd: string;
  createdAt: string;
  isActive: boolean;
}

export interface TerminalResize {
  cols: number;
  rows: number;
}
