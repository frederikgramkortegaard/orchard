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

  // Create worktree via Orchard API
  const res = await fetch(`${apiBase}/worktrees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      branch: `feature/${name}`,
      newBranch: true,
      mode,
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
        body: JSON.stringify({ input: finalTask, sendEnter: true }),
      });
    } catch {
      // Ignore errors
    }
  }, 5000);

  await logActivity(apiBase, 'event', 'agent', `MCP: Agent "${name}" created and started`, { worktreeId: worktree.id, branch: `feature/${name}`, mode }, projectId);

  const modeInfo = mode === 'plan' ? '\nMode: Plan (will create plan and wait for approval)' : '';
  return `Created agent "${name}" (${worktree.id})\nBranch: feature/${name}${modeInfo}\nTask: ${task}\n\nAgent is starting up and will begin working on the task shortly.`;
}
