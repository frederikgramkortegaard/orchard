import { logActivity } from '../utils/log-activity.js';

/**
 * Merge a completed feature branch into main
 */
export async function mergeBranch(
  apiBase: string,
  args: { worktreeId: string; deleteAfterMerge?: boolean }
): Promise<string> {
  const { worktreeId, deleteAfterMerge = false } = args;

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Merging branch ${worktreeId}`, { worktreeId, deleteAfterMerge });

  // Get worktree info first
  const worktreeRes = await fetch(`${apiBase}/worktrees/${encodeURIComponent(worktreeId)}`);
  if (!worktreeRes.ok) {
    throw new Error(`Worktree not found: ${worktreeId}`);
  }

  const worktree = await worktreeRes.json();

  // Check if already merged
  if (worktree.merged) {
    return `Branch ${worktree.branch} is already merged`;
  }

  // Perform merge via orchestrator API
  const res = await fetch(`${apiBase}/orchestrator/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: worktree.projectId,
      source: worktree.branch,
      target: 'main',
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Merge failed: ${error.error || res.statusText}`);
  }

  let result = `Successfully merged ${worktree.branch} into main`;

  // Optionally delete/archive the worktree
  if (deleteAfterMerge) {
    try {
      await fetch(`${apiBase}/worktrees/${encodeURIComponent(worktreeId)}/archive`, {
        method: 'POST',
      });
      result += '\nWorktree archived.';
    } catch {
      result += '\nNote: Failed to archive worktree.';
    }
  }

  return result;
}
