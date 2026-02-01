/**
 * Pop the first (oldest) entry from the merge queue
 * Returns the entry details and removes it from the queue
 */
export async function popFromMergeQueue(
  apiBase: string,
  args: { projectId: string }
): Promise<string> {
  const { projectId } = args;

  const res = await fetch(`${apiBase}/merge-queue/${encodeURIComponent(projectId)}/pop`, {
    method: 'POST',
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 404 && error.error === 'Merge queue is empty') {
      return 'Merge queue is empty - no items to pop.';
    }
    throw new Error(`Failed to pop from merge queue: ${error.error || res.statusText}`);
  }

  const data = await res.json();
  const entry = data.entry;

  const lines = [
    `Popped from merge queue:`,
    `  Worktree ID: ${entry.worktreeId}`,
    `  Branch: ${entry.branch}`,
    `  Summary: ${entry.summary || '(no summary)'}`,
    `  Has commits: ${entry.hasCommits ? 'yes' : 'no'}`,
    `  Completed at: ${new Date(entry.completedAt).toLocaleString()}`,
  ];

  return lines.join('\n');
}
