export interface LogActivityArgs {
  worktreeId?: string;
  activityType: 'file_edit' | 'command' | 'commit' | 'question' | 'task_complete' | 'error' | 'progress';
  summary: string;
  details?: Record<string, unknown>;
}

/**
 * Log an activity to the orchestrator's activity feed
 */
export async function logActivityTool(
  apiBase: string,
  args: LogActivityArgs
): Promise<string> {
  const { worktreeId, activityType, summary, details = {} } = args;

  const res = await fetch(`${apiBase}/agent/activity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worktreeId,
      activityType,
      summary,
      details,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to log activity: ${res.statusText} - ${error}`);
  }

  const result = await res.json() as { success: boolean; logId: number };
  return `Activity logged: ${summary}`;
}
