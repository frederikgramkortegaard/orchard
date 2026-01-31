import { logActivity } from '../utils/log-activity.js';

export interface ReportProgressArgs {
  worktreeId?: string;
  status: string;
  percentComplete?: number;
  currentStep?: string;
  details?: string;
}

/**
 * Report progress update to the orchestrator
 */
export async function reportProgress(
  apiBase: string,
  args: ReportProgressArgs
): Promise<string> {
  const { worktreeId, status, percentComplete, currentStep, details } = args;

  const res = await fetch(`${apiBase}/agent/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worktreeId,
      status,
      percentComplete,
      currentStep,
      details,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to report progress: ${res.statusText} - ${error}`);
  }

  const result = await res.json() as { success: boolean; message: string };

  await logActivity(
    apiBase,
    'event',
    'agent',
    `Agent progress: ${status}`,
    { worktreeId, status, percentComplete, currentStep, details },
  );

  const progressInfo = percentComplete !== undefined
    ? ` (${percentComplete}% complete)`
    : '';
  return result.message || `Progress reported: ${status}${progressInfo}`;
}
