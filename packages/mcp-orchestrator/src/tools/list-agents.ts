import { logActivity } from '../utils/log-activity.js';

/**
 * List all coding agents (worktrees) for a project
 */
export async function listAgents(
  apiBase: string,
  args: { projectId: string; filter?: string }
): Promise<string> {
  const { projectId, filter = 'all' } = args;

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Listing agents (filter: ${filter})`, { filter }, projectId);

  // Get worktrees from Orchard API
  const res = await fetch(`${apiBase}/worktrees?projectId=${projectId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch worktrees: ${res.statusText}`);
  }

  const worktrees = await res.json();

  // Filter based on status
  let filtered = worktrees.filter((w: any) => !w.isMain);
  switch (filter) {
    case 'active':
      filtered = filtered.filter((w: any) => !w.archived && !w.merged);
      break;
    case 'merged':
      filtered = filtered.filter((w: any) => w.merged);
      break;
    case 'archived':
      filtered = filtered.filter((w: any) => w.archived);
      break;
  }

  if (filtered.length === 0) {
    return `No agents found (filter: ${filter})`;
  }

  // Format output
  const lines = filtered.map((w: any) => {
    const status = w.archived ? 'ARCHIVED' : w.merged ? 'MERGED' : 'ACTIVE';
    const changes = w.status
      ? `${w.status.modified} modified, ${w.status.staged} staged, ${w.status.ahead} ahead`
      : 'unknown';
    return `- ${w.branch} (${w.id})\n  Status: ${status}\n  Changes: ${changes}`;
  });

  return `Agents (${filter}):\n\n${lines.join('\n\n')}`;
}
