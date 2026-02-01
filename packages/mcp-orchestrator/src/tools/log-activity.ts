export async function logActivity(
  baseUrl: string,
  args: {
    projectId: string;
    activityType: 'file_edit' | 'command' | 'commit' | 'task_complete' | 'error' | 'progress' | 'orchestrator';
    summary: string;
    details?: Record<string, unknown>;
  }
): Promise<string> {
  const { projectId, activityType, summary, details } = args;

  const res = await fetch(`${baseUrl}/agent/activity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      activityType,
      summary,
      details,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to log activity: ${res.statusText} - ${error}`);
  }

  const result = await res.json();
  return `Activity logged: ${summary} (logId: ${result.logId})`;
}
