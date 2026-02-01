/**
 * Merge a worktree from the merge queue
 */
export async function mergeFromQueue(
  apiBase: string,
  args: { worktreeId: string }
): Promise<string> {
  const { worktreeId } = args;

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
  const mergeRes = await fetch(`${apiBase}/orchestrator/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: worktree.projectId,
      source: worktree.branch,
      target: 'main',
    }),
  });

  if (!mergeRes.ok) {
    const error = await mergeRes.json().catch(() => ({ error: mergeRes.statusText }));
    throw new Error(`Merge failed: ${error.error || mergeRes.statusText}`);
  }

  // Mark the merge queue entry as merged
  const markRes = await fetch(
    `${apiBase}/merge-queue/${encodeURIComponent(worktree.projectId)}/${encodeURIComponent(worktreeId)}/merge`,
    { method: 'POST' }
  );

  if (!markRes.ok) {
    // Log but don't fail - the merge succeeded
    console.error(`Warning: Failed to mark merge queue entry as merged: ${worktreeId}`);
  }

  return `Successfully merged ${worktree.branch} into main and marked as merged in queue`;
}
