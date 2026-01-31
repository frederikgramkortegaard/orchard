const API_BASE = '/api';

export interface OrchestratorSession {
  id: string;
  projectId: string;
  terminalSessionId: string;
  createdAt: string;
}

export interface CreateFeatureResult {
  success: boolean;
  worktree?: {
    id: string;
    branch: string;
    path: string;
  };
  terminalSessionId?: string;
  message: string;
}

export interface MergeResult {
  success: boolean;
  hasConflicts?: boolean;
  conflicts?: string[];
  message: string;
}

export async function getOrchestratorSession(projectId: string): Promise<OrchestratorSession | null> {
  const res = await fetch(`${API_BASE}/orchestrator/${projectId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to get orchestrator session');
  return res.json();
}

export async function createOrchestratorSession(projectId: string): Promise<OrchestratorSession> {
  const res = await fetch(`${API_BASE}/orchestrator`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create orchestrator session');
  }
  return res.json();
}

export async function createFeature(
  projectId: string,
  name: string,
  description?: string
): Promise<CreateFeatureResult> {
  const res = await fetch(`${API_BASE}/orchestrator/create-feature`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, name, description }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create feature');
  }
  return res.json();
}

export async function mergeBranches(
  projectId: string,
  source: string,
  target = 'main'
): Promise<MergeResult> {
  const res = await fetch(`${API_BASE}/orchestrator/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, source, target }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to merge branches');
  }
  return res.json();
}

export interface WorktreeSession {
  worktreeId: string;
  sessionId: string;
  branch: string;
}

// Get active worktree sessions that can receive prompts
export async function getActiveWorktreeSessions(projectId: string): Promise<WorktreeSession[]> {
  const res = await fetch(`${API_BASE}/orchestrator/${projectId}/sessions`);
  if (!res.ok) {
    throw new Error('Failed to get active sessions');
  }
  const data = await res.json();
  return data.sessions;
}

// Send a prompt to a specific worktree's Claude session
export async function sendPromptToWorktree(
  projectId: string,
  worktreeId: string,
  prompt: string
): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/orchestrator/${projectId}/send-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worktreeId, prompt }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to send prompt');
  }
  return res.json();
}
