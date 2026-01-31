import { logActivity } from '../utils/log-activity.js';

/**
 * Restart a Claude session for a worktree (stop existing, start new)
 */
export async function restartSession(
  apiBase: string,
  args: { worktreeId: string; projectId: string; task?: string }
): Promise<string> {
  const { worktreeId, projectId, task } = args;

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Restarting session for worktree ${worktreeId}`, { worktreeId }, projectId);

  // Get existing sessions for this worktree
  const sessionsRes = await fetch(`${apiBase}/terminals/worktree/${worktreeId}`);
  if (sessionsRes.ok) {
    const sessions = await sessionsRes.json();
    // Stop all existing sessions for this worktree
    for (const session of sessions) {
      try {
        await fetch(`${apiBase}/terminals/${session.id}`, { method: 'DELETE' });
      } catch {
        // Ignore errors stopping old sessions
      }
    }
  }

  // Get worktree info
  const worktreeRes = await fetch(`${apiBase}/worktrees/${worktreeId}`);
  if (!worktreeRes.ok) {
    throw new Error(`Worktree ${worktreeId} not found`);
  }
  const worktree = await worktreeRes.json();

  // Get project info
  const projectRes = await fetch(`${apiBase}/projects/${projectId}`);
  if (!projectRes.ok) {
    throw new Error(`Project ${projectId} not found`);
  }
  const project = await projectRes.json();

  // Create new terminal session
  const res = await fetch(`${apiBase}/terminals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worktreeId,
      projectPath: project.path,
      cwd: worktree.path,
      initialCommand: 'claude --dangerously-skip-permissions',
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to start session: ${error.error || res.statusText}`);
  }

  const session = await res.json();

  // If a task was provided, send it after Claude starts up
  if (task) {
    setTimeout(async () => {
      try {
        // Send the task
        await fetch(`${apiBase}/terminals/${session.id}/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: task, sendEnter: true }),
        });
        // Send some enters to wake up Claude
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 500));
          await fetch(`${apiBase}/terminals/${session.id}/input`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: '', sendEnter: true }),
          });
        }
      } catch {
        // Ignore errors
      }
    }, 5000);
  }

  await logActivity(apiBase, 'event', 'agent', `Session restarted for worktree ${worktreeId}`, { sessionId: session.id, worktreeId, hasTask: !!task }, projectId);

  return `Restarted session for worktree ${worktreeId}\nNew session ID: ${session.id}\nPath: ${worktree.path}${task ? '\nTask will be sent after Claude starts up.' : ''}`;
}
