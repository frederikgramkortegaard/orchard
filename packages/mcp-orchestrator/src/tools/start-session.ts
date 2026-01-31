import { logActivity } from '../utils/log-activity.js';

/**
 * Start a Claude session for a worktree
 */
export async function startSession(
  apiBase: string,
  args: { worktreeId: string; projectId: string }
): Promise<string> {
  const { worktreeId, projectId } = args;

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Starting session for worktree ${worktreeId}`, { worktreeId }, projectId);

  // Get worktree info to get the path
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

  // Create the terminal session
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

  // Wait for Claude to be ready by polling terminal output
  const maxAttempts = 10;
  const pollInterval = 500;
  let ready = false;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    try {
      const outputRes = await fetch(`${apiBase}/terminals/${session.id}/output?lines=50`);
      if (outputRes.ok) {
        const data = await outputRes.json();
        const output = data.output || '';
        // Check for Claude prompt indicators
        if (output.includes('>') || output.includes('Claude') || output.includes('?')) {
          ready = true;
          break;
        }
      }
    } catch {
      // Continue polling
    }
  }

  await logActivity(apiBase, 'event', 'agent', `Session started for worktree ${worktreeId}`, { sessionId: session.id, worktreeId, ready }, projectId);

  return `Started session ${session.id} for worktree ${worktreeId}\nPath: ${worktree.path}\nReady: ${ready ? 'yes' : 'still starting...'}`;
}
