/**
 * Get the merge queue for a project
 */
export async function getMergeQueue(
  apiBase: string,
  args: { projectId: string }
): Promise<string> {
  const { projectId } = args;

  const res = await fetch(`${apiBase}/merge-queue?projectId=${encodeURIComponent(projectId)}`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to get merge queue: ${error.error || res.statusText}`);
  }

  const data = await res.json();
  const queue = data.queue || [];

  if (queue.length === 0) {
    return 'Merge queue is empty - no pending items to merge.';
  }

  const lines = [`Merge queue for project ${projectId} (${queue.length} items):\n`];

  for (const entry of queue) {
    const status = entry.mergedAt ? '✓ merged' : entry.hasCommits ? '● has commits' : '○ no commits';
    lines.push(`- ${entry.branch} (${entry.worktreeId})`);
    lines.push(`  Status: ${status}`);
    if (entry.summary) {
      lines.push(`  Summary: ${entry.summary}`);
    }
    lines.push(`  Completed: ${new Date(entry.completedAt).toLocaleString()}`);
    lines.push('');
  }

  return lines.join('\n');
}
