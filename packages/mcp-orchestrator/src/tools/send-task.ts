import { logActivity } from '../utils/log-activity.js';

/**
 * Send a task to an agent by starting a new claude -p session
 * (Since agents use -p mode, each task runs in a fresh session)
 */
export async function sendTask(
  apiBase: string,
  args: { worktreeId: string; message: string }
): Promise<string> {
  const { worktreeId, message } = args;

  // Get worktree info
  const worktreeRes = await fetch(`${apiBase}/worktrees/${worktreeId}`);
  if (!worktreeRes.ok) {
    throw new Error(`Worktree ${worktreeId} not found`);
  }
  const worktree = await worktreeRes.json();

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Sending task to agent ${worktree.branch}`, { worktreeId, branch: worktree.branch, message: message.slice(0, 100) });

  // Start a print session (streams claude -p output to SQLite)
  const sessionRes = await fetch(`${apiBase}/print-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worktreeId,
      task: message,
    }),
  });

  if (!sessionRes.ok) {
    throw new Error(`Failed to start agent session: ${sessionRes.statusText}`);
  }

  const session = await sessionRes.json();

  await logActivity(apiBase, 'event', 'agent', `Task sent to ${worktree.branch}`, { sessionId: session.id, worktreeId, branch: worktree.branch });

  return `Started print-mode task for ${worktree.branch}:\n\n${message.substring(0, 200)}${message.length > 200 ? '...' : ''}\n\nAgent will report completion via MCP when done.`;
}
