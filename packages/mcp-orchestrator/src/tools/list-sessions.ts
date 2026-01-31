import { logActivity } from '../utils/log-activity.js';

/**
 * List all terminal sessions for a project
 */
export async function listSessions(
  apiBase: string,
  args: { projectId: string }
): Promise<string> {
  const { projectId } = args;

  await logActivity(apiBase, 'action', 'orchestrator', 'MCP: Listing sessions', {}, projectId);

  const res = await fetch(`${apiBase}/terminals`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to list sessions: ${error.error || res.statusText}`);
  }

  const sessions = await res.json();

  if (!Array.isArray(sessions) || sessions.length === 0) {
    return 'No active terminal sessions found.';
  }

  const lines = sessions.map((s: any) => {
    return `- Session ${s.id}\n  Worktree: ${s.worktreeId}\n  Command: ${s.command || 'shell'}\n  Created: ${s.createdAt || 'unknown'}`;
  });

  return `Active Sessions (${sessions.length}):\n\n${lines.join('\n\n')}`;
}
