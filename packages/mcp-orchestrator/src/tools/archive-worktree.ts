import { logActivity } from '../utils/log-activity.js';

/**
 * Archive a completed worktree
 */
export async function archiveWorktree(
  apiBase: string,
  args: { worktreeId: string }
): Promise<string> {
  const { worktreeId } = args;

  const res = await fetch(`${apiBase}/worktrees/${encodeURIComponent(worktreeId)}/archive`, {
    method: 'POST',
  });

  if (!res.ok) {
    throw new Error(`Failed to archive worktree: ${res.statusText}`);
  }

  await logActivity(apiBase, 'action', 'worktree', `MCP: Archived worktree ${worktreeId}`, { worktreeId });

  return `Archived worktree ${worktreeId}`;
}
