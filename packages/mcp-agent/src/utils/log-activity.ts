/**
 * Log activity to Orchard's activity logger
 */
export async function logActivity(
  apiBase: string,
  type: 'action' | 'event' | 'decision' | 'error',
  category: 'worktree' | 'agent' | 'user' | 'system' | 'orchestrator',
  summary: string,
  details: Record<string, unknown> = {},
  projectId?: string
): Promise<void> {
  try {
    await fetch(`${apiBase}/orchestrator/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, category, summary, details, projectId }),
    });
  } catch (error) {
    // Don't fail the tool if logging fails
    console.error('Failed to log activity:', error);
  }
}
