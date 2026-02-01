import { logActivity } from '../utils/log-activity.js';

/**
 * Start a Claude session for a worktree
 * @param task - Optional task to run with claude -p. If not provided, starts interactive mode.
 */
export async function startSession(
  apiBase: string,
  args: { worktreeId: string; projectId: string; task?: string }
): Promise<string> {
  const { worktreeId, projectId, task } = args;

  const mode = task ? 'print' : 'interactive';
  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Starting ${mode} session for worktree ${worktreeId}`, { worktreeId, mode }, projectId);

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

  // Build the command - use -p for print mode with task, otherwise interactive
  let initialCommand: string;
  if (task) {
    // Escape single quotes in the task for shell
    const escapedTask = task.replace(/'/g, "'\\''");
    initialCommand = `claude -p '${escapedTask}' --dangerously-skip-permissions`;
  } else {
    initialCommand = 'claude --dangerously-skip-permissions';
  }

  // Create the terminal session
  const res = await fetch(`${apiBase}/terminals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worktreeId,
      projectPath: project.path,
      cwd: worktree.path,
      initialCommand,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to start session: ${error.error || res.statusText}`);
  }

  const session = await res.json();

  // For print mode (-p), the task runs immediately - no need to wait for prompt
  // For interactive mode, wait for Claude to be ready
  let ready = false;

  if (!task) {
    // Wait for Claude to be ready by polling terminal output
    const maxAttempts = 10;
    const pollInterval = 500;

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
  }

  await logActivity(apiBase, 'event', 'agent', `Session started for worktree ${worktree.branch}`, {
    sessionId: session.id,
    worktreeId,
    branch: worktree.branch,
    mode: task ? 'print' : 'interactive',
    ready: task ? 'running' : ready
  }, projectId);

  if (task) {
    return `Started print-mode session ${session.id} for worktree ${worktree.branch}\nPath: ${worktree.path}\nTask: ${task.substring(0, 100)}${task.length > 100 ? '...' : ''}\nStatus: Running (agent will report completion via MCP)`;
  }

  return `Started interactive session ${session.id} for worktree ${worktree.branch}\nPath: ${worktree.path}\nReady: ${ready ? 'yes' : 'still starting...'}`;
}
