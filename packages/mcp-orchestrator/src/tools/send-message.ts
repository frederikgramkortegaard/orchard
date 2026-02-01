/**
 * Send a message to the activity log and chat
 */
export async function sendMessage(
  apiBase: string,
  args: { projectId: string; message: string }
): Promise<string> {
  const { projectId, message } = args;

  // Post to activity log
  const activityRes = await fetch(`${apiBase}/orchestrator/activity`, {
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

  if (!activityRes.ok) {
    throw new Error(`Failed to log activity: ${activityRes.statusText}`);
  }

  // Also post to chat so it appears in the chat UI
  const chatRes = await fetch(`${apiBase}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      text: message,
      from: 'orchestrator',
    }),
  });

  if (!chatRes.ok) {
    throw new Error(`Failed to send chat message: ${chatRes.statusText}`);
  }

  return `Message sent: ${message}`;
}
