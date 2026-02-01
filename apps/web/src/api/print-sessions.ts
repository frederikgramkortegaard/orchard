const API_BASE = '/api';

export interface PrintSession {
  id: string;
  worktreeId: string;
  projectId: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  exitCode?: number;
  startedAt: string;
  completedAt?: string;
}

export interface OutputChunk {
  id: number;
  sessionId: string;
  chunk: string;
  timestamp: string;
}

export interface OutputResponse {
  sessionId: string;
  status: string;
  chunks: OutputChunk[];
  lastId: number;
}

export interface FullOutputResponse {
  sessionId: string;
  status: string;
  exitCode?: number;
  output: string;
}

export async function getPrintSessionsForWorktree(projectId: string, worktreeId: string): Promise<PrintSession[]> {
  const res = await fetch(`${API_BASE}/print-sessions?projectId=${projectId}&worktreeId=${worktreeId}`);
  if (!res.ok) throw new Error('Failed to get print sessions');
  return res.json();
}

export async function getPrintSession(projectId: string, sessionId: string): Promise<PrintSession> {
  const res = await fetch(`${API_BASE}/print-sessions/${sessionId}?projectId=${projectId}`);
  if (!res.ok) throw new Error('Failed to get print session');
  return res.json();
}

export async function getPrintSessionOutput(projectId: string, sessionId: string, afterId?: number): Promise<OutputResponse> {
  const url = afterId !== undefined
    ? `${API_BASE}/print-sessions/${sessionId}/output?projectId=${projectId}&afterId=${afterId}`
    : `${API_BASE}/print-sessions/${sessionId}/output?projectId=${projectId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to get session output');
  return res.json();
}

export async function getFullPrintSessionOutput(projectId: string, sessionId: string): Promise<FullOutputResponse> {
  const res = await fetch(`${API_BASE}/print-sessions/${sessionId}/output/full?projectId=${projectId}`);
  if (!res.ok) throw new Error('Failed to get full session output');
  return res.json();
}
