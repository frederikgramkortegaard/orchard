import type { FastifyInstance } from 'fastify';
import { databaseService } from '../services/database.service.js';
import { projectService } from '../services/project.service.js';
import { worktreeService } from '../services/worktree.service.js';

interface UsageStats {
  projectId: string;
  generatedAt: string;
  summary: {
    totalAgents: number;
    activeAgents: number;
    archivedAgents: number;
    mergedAgents: number;
    totalMessages: number;
    userMessages: number;
    orchestratorMessages: number;
    totalActivities: number;
    totalPrintSessions: number;
    completedPrintSessions: number;
    failedPrintSessions: number;
  };
  activityBreakdown: Array<{
    type: string;
    count: number;
  }>;
  categoryBreakdown: Array<{
    category: string;
    count: number;
  }>;
  recentActivity: Array<{
    date: string;
    count: number;
  }>;
  agentsByStatus: Array<{
    status: string;
    count: number;
  }>;
}

export async function usageRoutes(fastify: FastifyInstance) {
  // Get usage statistics for a project
  fastify.get<{
    Params: { projectId: string };
    Querystring: { days?: string };
  }>('/projects/:projectId/usage', async (request, reply) => {
    const { projectId } = request.params;
    const days = parseInt(request.query.days || '14', 10);

    const project = projectService.getProject(projectId);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    try {
      const db = databaseService.getDatabase(project.path);

      // Get worktree statistics
      const worktrees = await worktreeService.loadWorktreesForProject(projectId);
      const totalAgents = worktrees.filter(w => !w.isMain).length;
      const activeAgents = worktrees.filter(w => !w.isMain && !w.archived && !w.merged).length;
      const archivedAgents = worktrees.filter(w => !w.isMain && w.archived).length;
      const mergedAgents = worktrees.filter(w => !w.isMain && w.merged && !w.archived).length;

      // Get chat message counts
      const messageCountStmt = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN sender = 'user' THEN 1 ELSE 0 END) as user_messages,
          SUM(CASE WHEN sender = 'orchestrator' THEN 1 ELSE 0 END) as orchestrator_messages
        FROM chat_messages
        WHERE project_id = ?
      `);
      const messageCounts = messageCountStmt.get(projectId) as {
        total: number;
        user_messages: number;
        orchestrator_messages: number;
      };

      // Get activity log counts
      const activityCountStmt = db.prepare(`
        SELECT COUNT(*) as count FROM activity_logs WHERE project_id = ?
      `);
      const activityCount = (activityCountStmt.get(projectId) as { count: number }).count;

      // Get print session counts
      const printSessionStmt = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM print_sessions
        WHERE project_id = ?
      `);
      const printSessions = printSessionStmt.get(projectId) as {
        total: number;
        completed: number;
        failed: number;
      } || { total: 0, completed: 0, failed: 0 };

      // Get activity breakdown by type
      const activityTypeStmt = db.prepare(`
        SELECT type, COUNT(*) as count
        FROM activity_logs
        WHERE project_id = ?
        GROUP BY type
        ORDER BY count DESC
      `);
      const activityBreakdown = activityTypeStmt.all(projectId) as Array<{
        type: string;
        count: number;
      }>;

      // Get activity breakdown by category
      const categoryStmt = db.prepare(`
        SELECT category, COUNT(*) as count
        FROM activity_logs
        WHERE project_id = ?
        GROUP BY category
        ORDER BY count DESC
      `);
      const categoryBreakdown = categoryStmt.all(projectId) as Array<{
        category: string;
        count: number;
      }>;

      // Get recent activity by day
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString().split('T')[0];

      const recentActivityStmt = db.prepare(`
        SELECT DATE(timestamp) as date, COUNT(*) as count
        FROM activity_logs
        WHERE project_id = ? AND timestamp >= ?
        GROUP BY DATE(timestamp)
        ORDER BY date ASC
      `);
      const recentActivityRaw = recentActivityStmt.all(projectId, sinceStr) as Array<{
        date: string;
        count: number;
      }>;

      // Fill in missing days with zeros
      const recentActivityMap = new Map<string, number>();
      for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        recentActivityMap.set(key, 0);
      }
      for (const entry of recentActivityRaw) {
        recentActivityMap.set(entry.date, entry.count);
      }
      const recentActivity = Array.from(recentActivityMap.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Get agent session status breakdown
      const sessionStatusStmt = db.prepare(`
        SELECT status, COUNT(*) as count
        FROM agent_sessions
        WHERE project_id = ?
        GROUP BY status
        ORDER BY count DESC
      `);
      const agentsByStatus = sessionStatusStmt.all(projectId) as Array<{
        status: string;
        count: number;
      }>;

      const stats: UsageStats = {
        projectId,
        generatedAt: new Date().toISOString(),
        summary: {
          totalAgents,
          activeAgents,
          archivedAgents,
          mergedAgents,
          totalMessages: messageCounts?.total || 0,
          userMessages: messageCounts?.user_messages || 0,
          orchestratorMessages: messageCounts?.orchestrator_messages || 0,
          totalActivities: activityCount,
          totalPrintSessions: printSessions?.total || 0,
          completedPrintSessions: printSessions?.completed || 0,
          failedPrintSessions: printSessions?.failed || 0,
        },
        activityBreakdown,
        categoryBreakdown,
        recentActivity,
        agentsByStatus,
      };

      return stats;
    } catch (err: any) {
      console.error('Error fetching usage stats:', err);
      return reply.status(500).send({ error: err.message });
    }
  });
}
