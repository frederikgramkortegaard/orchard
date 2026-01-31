import type { WebSocket } from 'ws';
import { daemonClient } from '../pty/daemon-client.js';

interface TerminalMessage {
  type: string;
  sessionId?: string;
  data?: string;
  cols?: number;
  rows?: number;
  count?: number;
}

export function handleTerminalWebSocket(ws: WebSocket) {
  const subscribedSessions = new Set<string>();

  // Listen for daemon connection status changes
  const onDaemonConnected = () => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({
        type: 'daemon:status',
        connected: true,
        timestamp: Date.now(),
      }));
    }
  };

  const onDaemonDisconnected = () => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({
        type: 'daemon:status',
        connected: false,
        timestamp: Date.now(),
      }));
    }
  };

  daemonClient.on('connected', onDaemonConnected);
  daemonClient.on('disconnected', onDaemonDisconnected);

  ws.on('message', (rawMessage: Buffer) => {
    try {
      const message: TerminalMessage = JSON.parse(rawMessage.toString());

      switch (message.type) {
        case 'terminal:subscribe': {
          if (!message.sessionId) break;
          daemonClient.subscribeToSession(message.sessionId, ws);
          subscribedSessions.add(message.sessionId);
          break;
        }

        case 'terminal:unsubscribe': {
          if (!message.sessionId) break;
          daemonClient.unsubscribeFromSession(message.sessionId, ws);
          subscribedSessions.delete(message.sessionId);
          break;
        }

        case 'terminal:input': {
          if (!message.sessionId || !message.data) break;
          daemonClient.writeToSession(message.sessionId, message.data);
          break;
        }

        case 'terminal:resize': {
          if (!message.sessionId || !message.cols || !message.rows) break;
          daemonClient.resizeSession(message.sessionId, message.cols, message.rows);
          break;
        }

        case 'terminal:ack': {
          if (!message.sessionId || message.count === undefined) break;
          daemonClient.acknowledgeData(message.sessionId, message.count);
          break;
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
        }
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  ws.on('close', () => {
    // Clean up daemon event listeners
    daemonClient.off('connected', onDaemonConnected);
    daemonClient.off('disconnected', onDaemonDisconnected);

    // Unsubscribe from all sessions
    subscribedSessions.forEach((sessionId) => {
      daemonClient.unsubscribeFromSession(sessionId, ws);
    });
  });

  // Send connected message with daemon status
  ws.send(JSON.stringify({
    type: 'connected',
    timestamp: Date.now(),
    daemonConnected: daemonClient.isConnected(),
  }));
}
