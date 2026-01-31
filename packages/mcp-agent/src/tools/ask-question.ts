import { logActivity } from '../utils/log-activity.js';

export interface AskQuestionArgs {
  worktreeId: string;
  question: string;
  context?: string;
  options?: string[];
}

/**
 * Ask a question to the orchestrator for clarification
 */
export async function askQuestion(
  apiBase: string,
  args: AskQuestionArgs
): Promise<string> {
  const { worktreeId, question, context, options } = args;

  const res = await fetch(`${apiBase}/agent/question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worktreeId,
      question,
      context,
      options,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to ask question: ${res.statusText} - ${error}`);
  }

  const result = await res.json() as { success: boolean; message: string; questionId: string };

  await logActivity(
    apiBase,
    'event',
    'agent',
    `Agent asked question: ${question}`,
    { worktreeId, question, context, options },
  );

  return result.message || `Question submitted: ${question}`;
}
