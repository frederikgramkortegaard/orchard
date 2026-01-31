import { logActivity } from '../utils/log-activity.js';

/**
 * Get overall project status
 */
export async function getProjectStatus(
  apiBase: string,
  args: { projectId: string }
): Promise<string> {
  const { projectId } = args;

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Getting project status`, {}, projectId);

  // Get health check from orchestrator
  const healthRes = await fetch(`${apiBase}/orchestrator/${projectId}/health`);

  if (!healthRes.ok) {
    // Fallback to basic worktree list
    const worktreesRes = await fetch(`${apiBase}/worktrees?projectId=${projectId}`);
    if (!worktreesRes.ok) {
      throw new Error('Failed to fetch project status');
    }

    const worktrees = await worktreesRes.json();
    const active = worktrees.filter((w: any) => !w.isMain && !w.archived && !w.merged);
    const merged = worktrees.filter((w: any) => w.merged);

    return `Project Status:\n- Total worktrees: ${worktrees.length}\n- Active agents: ${active.length}\n- Merged branches: ${merged.length}`;
  }

  const health = await healthRes.json();

  const lines = [
    `Project Status (${projectId})`,
    `Generated: ${health.timestamp}`,
    '',
    'Summary:',
    `  - Total worktrees: ${health.summary.totalWorktrees}`,
    `  - Active agents: ${health.summary.activeWorktrees}`,
    `  - Merged branches: ${health.summary.mergedWorktrees}`,
    `  - Archived: ${health.summary.archivedWorktrees}`,
    `  - With uncommitted changes: ${health.summary.worktreesWithChanges}`,
  ];

  if (health.activeSessions?.length > 0) {
    lines.push('', 'Active Sessions:');
    for (const session of health.activeSessions) {
      lines.push(`  - ${session.branch} (${session.worktreeId})`);
    }
  }

  if (health.suggestedActions?.length > 0) {
    lines.push('', 'Suggested Actions:');
    for (const action of health.suggestedActions.slice(0, 5)) {
      lines.push(`  - [${action.priority}] ${action.type}: ${action.description}`);
    }
  }

  if (health.archiveCandidates?.length > 0) {
    lines.push('', 'Archive Candidates:');
    for (const candidate of health.archiveCandidates) {
      lines.push(`  - ${candidate.branch}: ${candidate.reason}`);
    }
  }

  return lines.join('\n');
}
