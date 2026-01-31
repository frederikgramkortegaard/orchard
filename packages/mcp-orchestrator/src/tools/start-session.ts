import { logActivity } from '../utils/log-activity.js';

/**
 * Start a new Claude session in a worktree
 */
export async function startSession(
  apiBase: string,
  args: { worktreeId: string }
): Promise<string> {
  const { worktreeId } = args;

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Starting Claude session in ${worktreeId}`, { worktreeId });

  // Create terminal session with Claude
  const sessionRes = await fetch(`${apiBase}/terminals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worktreeId,
      command: 'claude --dangerously-skip-permissions',
    }),
  });

  if (!sessionRes.ok) {
    const error = await sessionRes.json().catch(() => ({ error: sessionRes.statusText }));
    throw new Error(`Failed to create terminal session: ${error.error || sessionRes.statusText}`);
  }

  const session = await sessionRes.json();

  // Wait for Claude to be ready by polling terminal output
  const maxAttempts = 10;
  const pollInterval = 500;
  let ready = false;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    try {
      const outputRes = await fetch(`${apiBase}/terminals/${session.id}/output?lines=50`);
      if (outputRes.ok) {
        const data = await outputRes.json();
        const output = data.output || '';
        // Check for Claude prompt indicators
        if (output.includes('>') || output.includes('Claude') || output.includes('?')) {
          ready = true;
          break;
        }
      }
    } catch {
      // Continue polling
    }
  }

  await logActivity(apiBase, 'event', 'agent', `MCP: Claude session started in ${worktreeId}`, { worktreeId, sessionId: session.id, ready });

  return `Started Claude session in ${worktreeId}\nSession ID: ${session.id}\nReady: ${ready ? 'yes' : 'timed out (session created but Claude may still be starting)'}`;
}
