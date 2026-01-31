import { logActivity } from '../utils/log-activity.js';

/**
 * Get detailed status and output from a coding agent
 */
export async function getAgentStatus(
  apiBase: string,
  args: { worktreeId: string; includeOutput?: boolean; outputLines?: number }
): Promise<string> {
  const { worktreeId, includeOutput = true, outputLines = 50 } = args;

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Checking agent status ${worktreeId}`, { worktreeId });

  // Get worktree info
  const worktreeRes = await fetch(`${apiBase}/worktrees/${encodeURIComponent(worktreeId)}`);
  if (!worktreeRes.ok) {
    throw new Error(`Worktree not found: ${worktreeId}`);
  }

  const worktree = await worktreeRes.json();

  // Get terminal sessions
  const sessionsRes = await fetch(`${apiBase}/terminals/worktree/${encodeURIComponent(worktreeId)}`);
  const sessions = sessionsRes.ok ? await sessionsRes.json() : [];
  const hasSession = sessions.length > 0;

  let output = '';
  if (includeOutput && hasSession) {
    try {
      const outputRes = await fetch(
        `${apiBase}/terminals/${sessions[0].id}/output?lines=${outputLines}`
      );
      if (outputRes.ok) {
        const data = await outputRes.json();
        output = data.output || '';
      }
    } catch {
      output = '(failed to fetch output)';
    }
  }

  // Format status
  const status = worktree.archived
    ? 'ARCHIVED'
    : worktree.merged
    ? 'MERGED'
    : hasSession
    ? 'ACTIVE'
    : 'IDLE';

  const lines = [
    `Agent: ${worktree.branch} (${worktree.id})`,
    `Status: ${status}`,
    `Has Active Session: ${hasSession}`,
    `Git Status:`,
    `  - Modified files: ${worktree.status?.modified || 0}`,
    `  - Staged files: ${worktree.status?.staged || 0}`,
    `  - Commits ahead: ${worktree.status?.ahead || 0}`,
    `  - Commits behind: ${worktree.status?.behind || 0}`,
  ];

  if (worktree.lastCommitMessage) {
    lines.push(`Last Commit: ${worktree.lastCommitMessage}`);
  }

  if (output) {
    lines.push('', 'Recent Output:', '```', output.slice(-2000), '```');
  }

  return lines.join('\n');
}
