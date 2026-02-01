/**
 * Update the status of a chat message
 */
export async function updateMessageStatus(
  apiBase: string,
  args: { messageId: string; status: 'unread' | 'read' | 'working' | 'resolved' }
): Promise<string> {
  const { messageId, status } = args;

  const res = await fetch(`${apiBase}/chat/${messageId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });

  if (!res.ok) {
    throw new Error(`Failed to update message status: ${res.statusText}`);
  }

  return `Message ${messageId} status updated to: ${status}`;
}
