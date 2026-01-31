/**
 * Send a message to the activity log
 */
export async function sendMessage(
  apiBase: string,
  args: { projectId: string; message: string }
): Promise<string> {
  const { projectId, message } = args;

  // Post directly to activity log instead of chat
  const res = await fetch(`${apiBase}/orchestrator/activity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      type: 'event',
      category: 'orchestrator',
      summary: message,
      details: { source: 'mcp', activityType: 'orchestrator' },
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to send message: ${res.statusText}`);
  }

  return `Message logged: ${message}`;
}
