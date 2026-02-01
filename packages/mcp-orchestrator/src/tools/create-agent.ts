import { logActivity } from '../utils/log-activity.js';

type AgentMode = 'normal' | 'plan';

const PLAN_MODE_PREFIX = `IMPORTANT: Before implementing anything, you must first create a detailed plan and wait for user approval.

1. Analyze the task and create a step-by-step implementation plan
2. Write your plan to a file or present it clearly
3. Use the report_progress tool to indicate you are "awaiting_approval" with status "Plan ready for review"
4. STOP and wait for the user to approve your plan before proceeding
5. Only after receiving explicit approval (e.g., "approved", "proceed", "go ahead") should you implement

Do NOT start implementing until you receive approval.

---

TASK: `;

/**
 * Create a new coding agent in a worktree
 */
export async function createAgent(
  apiBase: string,
  args: { projectId: string; name: string; task: string; mode?: AgentMode }
): Promise<string> {
  const { projectId, name, task, mode = 'normal' } = args;

  // Prepend plan mode instructions if in plan mode
  const finalTask = mode === 'plan' ? PLAN_MODE_PREFIX + task : task;

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Creating agent "${name}"${mode === 'plan' ? ' (plan mode)' : ''}`, { name, task: task.slice(0, 100), mode }, projectId);

  // Create worktree via Orchard API (skip auto-session, we'll create our own with -p)
  const res = await fetch(`${apiBase}/worktrees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      branch: `feature/${name}`,
      newBranch: true,
      mode,
      skipAutoSession: true,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to create worktree: ${error.error || res.statusText}`);
  }

  const worktree = await res.json();

  // Get project info for projectPath
  const projectRes = await fetch(`${apiBase}/projects/${projectId}`);
  if (!projectRes.ok) {
    return `Created worktree ${worktree.id} but failed to get project info`;
  }
  const project = await projectRes.json();

  // Escape single quotes in the task for shell
  const escapedTask = finalTask.replace(/'/g, "'\\''");

  // Start a terminal session with Claude in -p mode (runs task directly, exits when done)
  const sessionRes = await fetch(`${apiBase}/terminals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worktreeId: worktree.id,
      projectPath: project.path,
      cwd: worktree.path,
      initialCommand: `claude -p '${escapedTask}' --dangerously-skip-permissions`,
    }),
  });

  if (!sessionRes.ok) {
    return `Created worktree ${worktree.id} but failed to start agent session`;
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

  await logActivity(apiBase, 'event', 'agent', `MCP: Agent "${name}" created (print mode)`, { worktreeId: worktree.id, branch: `feature/${name}`, mode }, projectId);

  const modeInfo = mode === 'plan' ? '\nMode: Plan (will create plan and wait for approval)' : '';
  return `Created agent "${name}" (${worktree.id})\nBranch: feature/${name}${modeInfo}\nTask: ${task}\n\nAgent running in print mode. Will report completion via MCP when done.`;
}
