import { logActivity } from '../utils/log-activity.js';

/**
 * Stop a terminal session
 */
export async function stopSession(
  apiBase: string,
  args: { sessionId: string; projectId: string }
): Promise<string> {
  const { sessionId, projectId } = args;

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Stopping session ${sessionId}`, { sessionId }, projectId);

  const res = await fetch(`${apiBase}/terminals/${sessionId}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to stop session: ${error.error || res.statusText}`);
  }

  await logActivity(apiBase, 'event', 'agent', `Session ${sessionId} stopped`, { sessionId }, projectId);

  return `Session ${sessionId} stopped successfully.`;
}
