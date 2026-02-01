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

  // Get project info for projectPath
  const projectRes = await fetch(`${apiBase}/projects/${worktree.projectId}`);
  if (!projectRes.ok) {
    throw new Error(`Project not found for worktree`);
  }
  const project = await projectRes.json();

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Sending task to agent ${worktree.branch}`, { worktreeId, branch: worktree.branch, message: message.slice(0, 100) });

  // Escape single quotes in the message for shell
  const escapedMessage = message.replace(/'/g, "'\\''");

  // Start a new terminal session with claude -p
  const sessionRes = await fetch(`${apiBase}/terminals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worktreeId,
      projectPath: project.path,
      cwd: worktree.path,
      initialCommand: `claude -p '${escapedMessage}' --dangerously-skip-permissions`,
    }),
  });

  if (!sessionRes.ok) {
    throw new Error(`Failed to start agent session: ${sessionRes.statusText}`);
  }

  const session = await sessionRes.json();

  // Wait for terminal to be ready and send enters to execute the command
  await new Promise(resolve => setTimeout(resolve, 1000));
  for (let i = 0; i < 3; i++) {
    await fetch(`${apiBase}/terminals/${session.id}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '\r', sendEnter: false }),
    });
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  await logActivity(apiBase, 'event', 'agent', `Task sent to ${worktree.branch}`, { sessionId: session.id, worktreeId, branch: worktree.branch });

  return `Started print-mode task for ${worktree.branch}:\n\n${message.substring(0, 200)}${message.length > 200 ? '...' : ''}\n\nAgent will report completion via MCP when done.`;
}
