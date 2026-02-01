import type { FastifyInstance } from 'fastify';
import { debugLogService, type DebugLogEntry } from '../services/debug-log.service.js';

export async function debugRoutes(fastify: FastifyInstance) {
  /**
   * GET /debug/logs - Returns recent debug logs from all sources
   *
   * Query params:
   * - source: Filter by source (server, daemon, orchestrator, ai-api)
   * - limit: Maximum number of logs to return (default: 200)
   * - level: Filter by level (debug, info, warn, error)
   */
  fastify.get<{
    Querystring: {
      source?: DebugLogEntry['source'];
      limit?: string;
      level?: DebugLogEntry['level'];
    };
  }>('/debug/logs', async (request) => {
    const { source, limit: limitStr, level } = request.query;
    const limit = limitStr ? parseInt(limitStr, 10) : 200;

    let logs = debugLogService.getLogs(source, limit);

    if (level) {
      logs = logs.filter(l => l.level === level);
    }

    return {
      logs,
      stats: debugLogService.getStats(),
    };
  });

  /**
   * GET /debug/ai-requests - Returns recent AI API requests/responses
   *
   * Query params:
   * - limit: Maximum number of entries to return (default: 100)
   * - type: Filter by type (request, response)
   */
  fastify.get<{
    Querystring: {
      limit?: string;
      type?: 'request' | 'response';
    };
  }>('/debug/ai-requests', async (request) => {
    const { limit: limitStr, type } = request.query;
    const limit = limitStr ? parseInt(limitStr, 10) : 100;

    let requests = debugLogService.getAIRequests(limit);

    if (type) {
      requests = requests.filter(r => r.type === type);
    }

    return {
      requests,
      stats: debugLogService.getStats(),
    };
  });

  /**
   * GET /debug/stats - Returns stats about stored logs
   */
  fastify.get('/debug/stats', async () => {
    return debugLogService.getStats();
  });

  /**
   * DELETE /debug/logs - Clear all logs
   */
  fastify.delete('/debug/logs', async () => {
    debugLogService.clearLogs();
    return { success: true, message: 'Logs cleared' };
  });

  /**
   * DELETE /debug/ai-requests - Clear AI request logs
   */
  fastify.delete('/debug/ai-requests', async () => {
    debugLogService.clearAIRequests();
    return { success: true, message: 'AI request logs cleared' };
  });

  /**
   * POST /debug/log - Add a log entry (for testing or external sources)
   */
  fastify.post<{
    Body: {
      source: DebugLogEntry['source'];
      level: DebugLogEntry['level'];
      message: string;
      details?: Record<string, unknown>;
    };
  }>('/debug/log', async (request) => {
    const { source, level, message, details } = request.body;
    const entry = debugLogService.log(source, level, message, details);
    return { success: true, entry };
  });
}
