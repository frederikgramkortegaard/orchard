/**
 * Merge a worktree from the merge queue
 */
export async function mergeFromQueue(
  apiBase: string,
  args: { worktreeId: string }
): Promise<string> {
  const { worktreeId } = args;

  // Call the merge queue endpoint directly - it handles everything
  const res = await fetch(`${apiBase}/merge-queue/${encodeURIComponent(worktreeId)}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to merge from queue: ${error.error || res.statusText}`);
  }

  const data = await res.json();
  return `Successfully merged ${data.branch || worktreeId} into main`;
}
