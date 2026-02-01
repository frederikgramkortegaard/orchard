import { logActivity } from '../utils/log-activity.js';
import { spawn } from 'child_process';

/**
 * Run a one-shot task using claude -p (print mode)
 * More efficient than interactive sessions for quick tasks
 */
export async function runTask(
  apiBase: string,
  args: { worktreeId: string; projectId: string; task: string; timeout?: number }
): Promise<string> {
  const { worktreeId, projectId, task, timeout = 120000 } = args;

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Running task in ${worktreeId}`, { worktreeId, task: task.slice(0, 100) }, projectId);

  // Get worktree info to get the path
  const worktreeRes = await fetch(`${apiBase}/worktrees/${worktreeId}`);
  if (!worktreeRes.ok) {
    throw new Error(`Worktree ${worktreeId} not found`);
  }
  const worktree = await worktreeRes.json();

  // Run claude -p with the task
  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const claude = spawn('claude', ['-p', task, '--dangerously-skip-permissions'], {
      cwd: worktree.path,
      timeout,
      env: {
        ...process.env,
        // Ensure we're in the right working directory context
        ORCHARD_WORKTREE_ID: worktreeId,
        ORCHARD_PROJECT_ID: projectId,
      },
    });

    let stdout = '';
    let stderr = '';

    claude.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    claude.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    claude.on('error', (err) => {
      reject(err);
    });

    claude.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });

    // Handle timeout
    setTimeout(() => {
      claude.kill('SIGTERM');
      reject(new Error(`Task timed out after ${timeout}ms`));
    }, timeout);
  });

  await logActivity(
    apiBase,
    result.exitCode === 0 ? 'event' : 'error',
    'agent',
    `Task completed in ${worktreeId}: ${result.exitCode === 0 ? 'success' : 'failed'}`,
    { worktreeId, exitCode: result.exitCode, outputLength: result.stdout.length },
    projectId
  );

  if (result.exitCode !== 0) {
    return `Task failed (exit code ${result.exitCode}):\n\nstderr:\n${result.stderr}\n\nstdout:\n${result.stdout}`;
  }

  return result.stdout || 'Task completed with no output';
}
