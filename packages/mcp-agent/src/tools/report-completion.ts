import { logActivity } from '../utils/log-activity.js';

export interface ReportCompletionArgs {
  worktreeId?: string;
  summary: string;
  details?: string;
}

/**
 * Report task completion to the orchestrator
 */
export async function reportCompletion(
  apiBase: string,
  args: ReportCompletionArgs
): Promise<string> {
  const { worktreeId, summary, details } = args;

  const res = await fetch(`${apiBase}/agent/completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worktreeId,
      summary,
      details,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to report completion: ${res.statusText} - ${error}`);
  }

  const result = await res.json() as { success: boolean; message: string };

  await logActivity(
    apiBase,
    'event',
    'agent',
    `Agent completed task: ${summary}`,
    { worktreeId, summary, details, activityType: 'task_complete' },
  );

  return result.message || `Completion reported: ${summary}`;
}
