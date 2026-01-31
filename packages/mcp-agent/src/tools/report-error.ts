import { logActivity } from '../utils/log-activity.js';

export interface ReportErrorArgs {
  worktreeId: string;
  error: string;
  severity?: 'warning' | 'error' | 'blocker';
  context?: string;
  suggestedAction?: string;
}

/**
 * Report an error or blocker to the orchestrator
 */
export async function reportError(
  apiBase: string,
  args: ReportErrorArgs
): Promise<string> {
  const { worktreeId, error, severity = 'error', context, suggestedAction } = args;

  const res = await fetch(`${apiBase}/agent/error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worktreeId,
      error,
      severity,
      context,
      suggestedAction,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to report error: ${res.statusText} - ${errorText}`);
  }

  const result = await res.json() as { success: boolean; message: string };

  await logActivity(
    apiBase,
    'error',
    'agent',
    `Agent ${severity}: ${error}`,
    { worktreeId, error, severity, context, suggestedAction },
  );

  return result.message || `Error reported (${severity}): ${error}`;
}
