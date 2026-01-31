import { logActivity } from '../utils/log-activity.js';

/**
 * Send a message to the user via the orchestrator chat
 */
export async function sendMessage(
  apiBase: string,
  args: { projectId: string; message: string }
): Promise<string> {
  const { projectId, message } = args;

  // Post message to /chat endpoint (the actual chat UI)
  const res = await fetch(`${apiBase}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      text: message,
      from: 'orchestrator',
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to send message: ${res.statusText}`);
  }

  await logActivity(apiBase, 'event', 'orchestrator', `MCP: Sent message to user`, { message: message.slice(0, 100) }, projectId);

  return `Message sent: ${message}`;
}
