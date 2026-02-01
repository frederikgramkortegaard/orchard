import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { worktreeService } from '../services/worktree.service.js';
import { databaseService } from '../services/database.service.js';
import { projectService } from '../services/project.service.js';

export async function agentRoutes(fastify: FastifyInstance) {
  // Report task completion
  fastify.post<{
    Body: {
      worktreeId: string;
      summary: string;
      details?: string;
    };
  }>('/agent/completion', async (request, reply) => {
    const { worktreeId, summary, details } = request.body;

    if (!worktreeId || !summary) {
      return reply.status(400).send({ error: 'worktreeId and summary are required' });
    }

    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const project = projectService.getProject(worktree.projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Log the completion
    const logId = databaseService.addActivityLog(project.path, worktree.projectId, {
      type: 'event',
      category: 'agent',
      summary: `Agent completed: ${summary}`,
      details: { worktreeId, summary, details, branch: worktree.branch },
    });

    // Add a chat message so the orchestrator can see it
    const messageId = randomUUID();
    databaseService.addChatMessage(project.path, {
      id: messageId,
      projectId: worktree.projectId,
      from: 'user', // Appears as user message to orchestrator
      text: `[Agent ${worktree.branch}] Task completed: ${summary}${details ? `\n\nDetails: ${details}` : ''}`,
    });

    return {
      success: true,
      message: `Completion reported for ${worktree.branch}`,
      logId,
      messageId,
    };
  });

  // Ask question / request clarification
  fastify.post<{
    Body: {
      worktreeId: string;
      question: string;
      context?: string;
      options?: string[];
    };
  }>('/agent/question', async (request, reply) => {
    const { worktreeId, question, context, options } = request.body;

    if (!worktreeId || !question) {
      return reply.status(400).send({ error: 'worktreeId and question are required' });
    }

    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const project = projectService.getProject(worktree.projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const questionId = randomUUID();

    // Log the question
    databaseService.addActivityLog(project.path, worktree.projectId, {
      type: 'event',
      category: 'agent',
      summary: `Agent question: ${question}`,
      details: { worktreeId, question, context, options, questionId, branch: worktree.branch },
    });

    // Add as chat message for orchestrator to see
    let messageText = `[Agent ${worktree.branch}] Question: ${question}`;
    if (context) {
      messageText += `\n\nContext: ${context}`;
    }
    if (options && options.length > 0) {
      messageText += `\n\nOptions:\n${options.map((opt, i) => `  ${i + 1}. ${opt}`).join('\n')}`;
    }

    const messageId = randomUUID();
    databaseService.addChatMessage(project.path, {
      id: messageId,
      projectId: worktree.projectId,
      from: 'user',
      text: messageText,
    });

    return {
      success: true,
      message: `Question submitted for ${worktree.branch}`,
      questionId,
      messageId,
    };
  });

  // Report progress update
  fastify.post<{
    Body: {
      worktreeId: string;
      status: string;
      percentComplete?: number;
      currentStep?: string;
      details?: string;
    };
  }>('/agent/progress', async (request, reply) => {
    const { worktreeId, status, percentComplete, currentStep, details } = request.body;

    if (!worktreeId || !status) {
      return reply.status(400).send({ error: 'worktreeId and status are required' });
    }

    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const project = projectService.getProject(worktree.projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Log the progress update
    const logId = databaseService.addActivityLog(project.path, worktree.projectId, {
      type: 'event',
      category: 'agent',
      summary: `Agent progress: ${status}`,
      details: { worktreeId, status, percentComplete, currentStep, details, branch: worktree.branch },
    });

    const progressInfo = percentComplete !== undefined ? ` (${percentComplete}%)` : '';
    return {
      success: true,
      message: `Progress reported for ${worktree.branch}: ${status}${progressInfo}`,
      logId,
    };
  });

  // Report error/blocker
  fastify.post<{
    Body: {
      worktreeId: string;
      error: string;
      severity?: 'warning' | 'error' | 'blocker';
      context?: string;
      suggestedAction?: string;
    };
  }>('/agent/error', async (request, reply) => {
    const { worktreeId, error, severity = 'error', context, suggestedAction } = request.body;

    if (!worktreeId || !error) {
      return reply.status(400).send({ error: 'worktreeId and error are required' });
    }

    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const project = projectService.getProject(worktree.projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Log the error
    const logId = databaseService.addActivityLog(project.path, worktree.projectId, {
      type: 'error',
      category: 'agent',
      summary: `Agent ${severity}: ${error}`,
      details: { worktreeId, error, severity, context, suggestedAction, branch: worktree.branch },
    });

    // Add as chat message for orchestrator to see (especially for blockers)
    let messageText = `[Agent ${worktree.branch}] ${severity.toUpperCase()}: ${error}`;
    if (context) {
      messageText += `\n\nContext: ${context}`;
    }
    if (suggestedAction) {
      messageText += `\n\nSuggested action: ${suggestedAction}`;
    }

    const messageId = randomUUID();
    databaseService.addChatMessage(project.path, {
      id: messageId,
      projectId: worktree.projectId,
      from: 'user',
      text: messageText,
    });

    return {
      success: true,
      message: `${severity} reported for ${worktree.branch}`,
      logId,
      messageId,
    };
  });

  // Log agent activity (for the activity feed)
  fastify.post<{
    Body: {
      worktreeId: string;
      activityType: 'file_edit' | 'command' | 'commit' | 'question' | 'task_complete' | 'error' | 'progress';
      summary: string;
      details?: Record<string, unknown>;
    };
  }>('/agent/activity', async (request, reply) => {
    const { worktreeId, activityType, summary, details = {} } = request.body;

    if (!worktreeId || !activityType || !summary) {
      return reply.status(400).send({ error: 'worktreeId, activityType, and summary are required' });
    }

    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    const project = projectService.getProject(worktree.projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Map activity type to log type
    const logType = activityType === 'error' ? 'error' : 'action';

    // Log the activity
    const logId = databaseService.addActivityLog(project.path, worktree.projectId, {
      type: logType,
      category: 'agent',
      summary,
      details: { ...details, activityType, worktreeId, branch: worktree.branch },
    });

    return {
      success: true,
      logId,
    };
  });

  // Get agent status (for agent to check its own worktree info)
  fastify.get<{
    Querystring: { worktreeId: string };
  }>('/agent/status', async (request, reply) => {
    const { worktreeId } = request.query;

    if (!worktreeId) {
      return reply.status(400).send({ error: 'worktreeId is required' });
    }

    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    return {
      id: worktree.id,
      branch: worktree.branch,
      projectId: worktree.projectId,
      path: worktree.path,
      status: worktree.status,
      createdAt: worktree.createdAt,
    };
  });
}
