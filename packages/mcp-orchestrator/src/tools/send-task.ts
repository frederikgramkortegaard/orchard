import { logActivity } from '../utils/log-activity.js';

/**
 * Send a task or message to an existing coding agent
 */
export async function sendTask(
  apiBase: string,
  args: { worktreeId: string; message: string }
): Promise<string> {
  const { worktreeId, message } = args;

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Sending task to agent ${worktreeId}`, { worktreeId, message: message.slice(0, 100) });

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

  // Send the message to the terminal
  const res = await fetch(`${apiBase}/terminals/${sessionId}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: message, sendEnter: true }),
  });

  if (!res.ok) {
    throw new Error(`Failed to send message: ${res.statusText}`);
  }

  return `Sent task to agent ${worktreeId}:\n\n${message}`;
}
