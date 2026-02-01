import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { terminalsRoutes } from './routes/terminals.js';
import { projectsRoutes } from './routes/projects.js';
import { worktreesRoutes } from './routes/worktrees.js';
import { orchestratorRoutes } from './routes/orchestrator.js';
import { filesRoutes } from './routes/files.js';
import { messagesRoutes } from './routes/messages.js';
import { agentRoutes } from './routes/agent.js';
import { diffRoutes } from './routes/diff.js';
import { printSessionsRoutes } from './routes/print-sessions.js';
import { handleTerminalWebSocket } from './websocket/terminal.handler.js';
import { projectService } from './services/project.service.js';
import { messageQueueService } from './services/message-queue.service.js';
import { orchestratorLoopService } from './services/orchestrator-loop.service.js';

const fastify = Fastify({
  logger: true,
});

await fastify.register(cors, {
  origin: true,
});

await fastify.register(websocket);

// Initialize services
await projectService.initialize();
await messageQueueService.initialize(); // Load persisted messages, clean up old ones
await orchestratorLoopService.initialize(); // Initialize orchestrator loop with session persistence

// Health check endpoint
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Register routes
fastify.register(terminalsRoutes);
fastify.register(projectsRoutes);
fastify.register(worktreesRoutes);
fastify.register(orchestratorRoutes);
fastify.register(filesRoutes);
fastify.register(messagesRoutes);
fastify.register(agentRoutes);
fastify.register(diffRoutes);
fastify.register(printSessionsRoutes);

// WebSocket endpoint
fastify.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (socket) => {
    handleTerminalWebSocket(socket);
  });
});

const start = async () => {
  try {
    await fastify.listen({ port: 3001, host: '0.0.0.0' });
    console.log('Server running at http://localhost:3001');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
