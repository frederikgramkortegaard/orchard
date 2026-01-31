import { logActivity } from '../utils/log-activity.js';

/**
 * Nudge a stuck agent by sending enter presses
 */
export async function nudgeAgent(
  apiBase: string,
  args: { worktreeId: string }
): Promise<string> {
  const { worktreeId } = args;

  // Get terminal sessions for this worktree
  const sessionsRes = await fetch(`${apiBase}/terminals/worktree/${encodeURIComponent(worktreeId)}`);
  if (!sessionsRes.ok) {
    throw new Error(`Failed to find sessions for worktree: ${sessionsRes.statusText}`);
  }

  const sessions = await sessionsRes.json();
  if (sessions.length === 0) {
    throw new Error(`No active session found for worktree ${worktreeId}`);
  }

  const sessionId = sessions[0].id;

  // Send enter press to wake up the agent
  await fetch(`${apiBase}/terminals/${sessionId}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: '\r', sendEnter: false }),
  });

  // Send another after a short delay
  await new Promise(resolve => setTimeout(resolve, 500));
  await fetch(`${apiBase}/terminals/${sessionId}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: '\r', sendEnter: false }),
  });

  await logActivity(apiBase, 'action', 'agent', `MCP: Nudged agent ${worktreeId}`, { worktreeId });

  return `Nudged agent in ${worktreeId}`;
}
