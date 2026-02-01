import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { worktreeService } from '../services/worktree.service.js';
import { databaseService } from '../services/database.service.js';
import { projectService } from '../services/project.service.js';

/**
 * Check if a worktree has any commits beyond the main branch
 */
function worktreeHasCommits(worktreePath: string, mainBranch: string = 'main'): boolean {
  try {
    // Count commits on this branch that aren't in main
    const result = execSync(
      `git log ${mainBranch}..HEAD --oneline 2>/dev/null | wc -l`,
      { cwd: worktreePath, encoding: 'utf-8' }
    );
    const commitCount = parseInt(result.trim(), 10);
    return commitCount > 0;
  } catch {
    // If git log fails (e.g., main doesn't exist), try checking if there are any commits at all
    try {
      const result = execSync('git log --oneline -1 2>/dev/null', {
        cwd: worktreePath,
        encoding: 'utf-8',
      });
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }
}

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

    // Check if the worktree has any commits
    const hasCommits = worktreeHasCommits(worktree.path);

    // Log the completion to activity feed only (not chat)
    const logId = databaseService.addActivityLog(project.path, worktree.projectId, {
      type: 'event',
      category: 'agent',
      summary: `Agent completed: ${summary}`,
      details: { worktreeId, summary, details, branch: worktree.branch, hasCommits },
    });

    // If the worktree has commits, add to merge queue
    let addedToMergeQueue = false;
    if (hasCommits) {
      databaseService.addToMergeQueue(project.path, {
        worktreeId,
        branch: worktree.branch,
        summary,
        hasCommits: true,
      });
      addedToMergeQueue = true;

      // Log the merge queue addition
      databaseService.addActivityLog(project.path, worktree.projectId, {
        type: 'event',
        category: 'system',
        summary: `Added ${worktree.branch} to merge queue`,
        details: { worktreeId, branch: worktree.branch, summary },
      });
    }

    return {
      success: true,
      message: `Completion reported for ${worktree.branch}`,
      logId,
      hasCommits,
      addedToMergeQueue,
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

    // Log the question to activity feed only (not chat)
    const logId = databaseService.addActivityLog(project.path, worktree.projectId, {
      type: 'event',
      category: 'agent',
      summary: `Agent question: ${question}`,
      details: { worktreeId, question, context, options, questionId, branch: worktree.branch },
    });

    return {
      success: true,
      message: `Question submitted for ${worktree.branch}`,
      questionId,
      logId,
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

    // Log the error to activity feed only (not chat)
    const logId = databaseService.addActivityLog(project.path, worktree.projectId, {
      type: 'error',
      category: 'agent',
      summary: `Agent ${severity}: ${error}`,
      details: { worktreeId, error, severity, context, suggestedAction, branch: worktree.branch },
    });

    return {
      success: true,
      message: `${severity} reported for ${worktree.branch}`,
      logId,
    };
  });

  // Log activity (for the activity feed) - works for both agents and orchestrator
  fastify.post<{
    Body: {
      worktreeId?: string;
      projectId?: string;
      activityType: 'file_edit' | 'command' | 'commit' | 'question' | 'task_complete' | 'error' | 'progress' | 'orchestrator';
      summary: string;
      details?: Record<string, unknown>;
    };
  }>('/agent/activity', async (request, reply) => {
    const { worktreeId, projectId: directProjectId, activityType, summary, details = {} } = request.body;

    if (!activityType || !summary) {
      return reply.status(400).send({ error: 'activityType and summary are required' });
    }

    // Either worktreeId or projectId must be provided
    if (!worktreeId && !directProjectId) {
      return reply.status(400).send({ error: 'Either worktreeId or projectId is required' });
    }

    let project;
    let worktree;
    let resolvedProjectId: string;

    if (worktreeId) {
      // Agent context - look up project via worktree
      worktree = worktreeService.getWorktree(worktreeId);
      if (!worktree) {
        return reply.status(404).send({ error: 'Worktree not found' });
      }
      project = projectService.getProject(worktree.projectId);
      resolvedProjectId = worktree.projectId;
    } else {
      // Orchestrator context - use projectId directly
      project = projectService.getProject(directProjectId!);
      resolvedProjectId = directProjectId!;
    }

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Map activity type to log type and category
    const logType = activityType === 'error' ? 'error' : 'action';
    const category = worktreeId ? 'agent' : 'orchestrator';

    // Log the activity
    const logId = databaseService.addActivityLog(project.path, resolvedProjectId, {
      type: logType,
      category,
      summary,
      details: {
        ...details,
        activityType,
        ...(worktreeId && { worktreeId, branch: worktree?.branch }),
      },
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
