import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';

type MessageHandler = (data: unknown) => void;

interface WebSocketContextValue {
  send: (data: unknown) => void;
  subscribe: (type: string, handler: MessageHandler) => () => void;
  isConnected: boolean;
  connectionId: number; // Incremented on each reconnect to trigger re-subscriptions
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

const PING_INTERVAL = 30000; // Send ping every 30 seconds
const PONG_TIMEOUT = 10000; // Expect pong within 10 seconds

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [connectionId, setConnectionId] = useState(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttempts = useRef(0);
  const pingIntervalRef = useRef<number | null>(null);
  const pongTimeoutRef = useRef<number | null>(null);
  const lastPongRef = useRef<number>(Date.now());

  const clearPingPong = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
      pongTimeoutRef.current = null;
    }
  }, []);

  const startPingPong = useCallback(() => {
    clearPingPong();

    pingIntervalRef.current = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        // Send ping
        wsRef.current.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));

        // Set a timeout for pong response
        pongTimeoutRef.current = window.setTimeout(() => {
          // No pong received - connection is stale
          console.warn('WebSocket pong timeout - reconnecting...');
          wsRef.current?.close();
        }, PONG_TIMEOUT);
      }
    }, PING_INTERVAL);
  }, [clearPingPong]);

  const connect = useCallback(() => {
    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Don't connect if already connected
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Clear any existing ping/pong
    clearPingPong();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttempts.current = 0;
      lastPongRef.current = Date.now();
      // Increment connectionId to trigger re-subscriptions in consumers
      setConnectionId((prev) => prev + 1);
      // Start heartbeat
      startPingPong();
    };

    ws.onclose = () => {
      setIsConnected(false);
      clearPingPong();
      // Auto-reconnect with exponential backoff (max 5 seconds)
      const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts.current), 5000);
      reconnectAttempts.current++;
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, delay);
    };

    ws.onerror = () => {
      // Will trigger onclose, which handles reconnect
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle pong - clear the timeout
        if (data.type === 'pong') {
          lastPongRef.current = Date.now();
          if (pongTimeoutRef.current) {
            clearTimeout(pongTimeoutRef.current);
            pongTimeoutRef.current = null;
          }
          return;
        }

        const handlers = handlersRef.current.get(data.type);
        if (handlers) {
          handlers.forEach((handler) => handler(data));
        }
      } catch (err) {
        console.error('WebSocket message parse error:', err);
      }
    };
  }, [clearPingPong, startPingPong]);

  useEffect(() => {
    connect();

    return () => {
      clearPingPong();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect, clearPingPong]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const subscribe = useCallback((type: string, handler: MessageHandler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);

    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ send, subscribe, isConnected, connectionId }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}
