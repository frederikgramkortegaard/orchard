import { logActivity } from '../utils/log-activity.js';

/**
 * Get recent chat messages from the conversation history
 */
export async function getMessages(
  apiBase: string,
  args: { projectId: string; limit?: number; unreadOnly?: boolean }
): Promise<string> {
  const { projectId, limit = 20, unreadOnly = false } = args;

  // Read from /chat endpoint (the actual conversation history)
  const res = await fetch(`${apiBase}/chat?projectId=${projectId}&limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch chat: ${res.statusText}`);
  }

  const messages = await res.json();

  if (messages.length === 0) {
    return 'No messages yet.';
  }

  // Optionally filter to user messages only
  const filtered = unreadOnly
    ? messages.filter((m: any) => m.from === 'user')
    : messages;

  // Format messages with timestamp and sender
  const formatted = filtered.map((m: any) => {
    const time = new Date(m.timestamp).toLocaleTimeString();
    const date = new Date(m.timestamp).toLocaleDateString();
    const from = m.from === 'user' ? 'User' : 'Orchestrator';
    return `[${date} ${time}] ${from}: ${m.text}`;
  }).join('\n');

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Read ${filtered.length} chat messages`, {}, projectId);

  return `Chat messages (${filtered.length}):\n\n${formatted}`;
}
