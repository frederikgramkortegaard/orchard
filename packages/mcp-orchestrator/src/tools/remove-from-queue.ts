/**
 * Remove a worktree from the merge queue
 */
export async function removeFromQueue(
  apiBase: string,
  args: { worktreeId: string }
): Promise<string> {
  const { worktreeId } = args;

  // Get worktree info first to get projectId
  const worktreeRes = await fetch(`${apiBase}/worktrees/${encodeURIComponent(worktreeId)}`);
  if (!worktreeRes.ok) {
    throw new Error(`Worktree not found: ${worktreeId}`);
  }

  const worktree = await worktreeRes.json();

  // Call DELETE endpoint to remove from merge queue
  const res = await fetch(
    `${apiBase}/merge-queue/${encodeURIComponent(worktree.projectId)}/${encodeURIComponent(worktreeId)}`,
    { method: 'DELETE' }
  );

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to remove from queue: ${error.error || res.statusText}`);
  }

  return `Successfully removed ${worktree.branch} from the merge queue`;
}
