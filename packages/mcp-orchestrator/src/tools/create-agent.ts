import { logActivity } from '../utils/log-activity.js';

/**
 * Create a new coding agent in a worktree
 */
export async function createAgent(
  apiBase: string,
  args: { projectId: string; name: string; task: string }
): Promise<string> {
  const { projectId, name, task } = args;

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Creating agent "${name}"`, { name, task: task.slice(0, 100) }, projectId);

  // Create worktree via Orchard API
  const res = await fetch(`${apiBase}/worktrees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      branch: `feature/${name}`,
      newBranch: true,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to create worktree: ${error.error || res.statusText}`);
  }

  const worktree = await res.json();

  // Start a terminal session with Claude in the worktree
  const sessionRes = await fetch(`${apiBase}/terminals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worktreeId: worktree.id,
      command: 'claude --dangerously-skip-permissions',
    }),
  });

  if (!sessionRes.ok) {
    return `Created worktree ${worktree.id} but failed to start agent session`;
  }

  const session = await sessionRes.json();

  // Send the initial task (after a delay for Claude to start)
  setTimeout(async () => {
    try {
      await fetch(`${apiBase}/terminals/${session.id}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: task, sendEnter: true }),
      });
    } catch {
      // Ignore errors
    }
  }, 5000);

  await logActivity(apiBase, 'event', 'agent', `MCP: Agent "${name}" created and started`, { worktreeId: worktree.id, branch: `feature/${name}` }, projectId);

  return `Created agent "${name}" (${worktree.id})\nBranch: feature/${name}\nTask: ${task}\n\nAgent is starting up and will begin working on the task shortly.`;
}
