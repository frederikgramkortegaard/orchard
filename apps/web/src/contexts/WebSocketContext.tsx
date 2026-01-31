import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';

type MessageHandler = (data: unknown) => void;

interface WebSocketContextValue {
  send: (data: unknown) => void;
  subscribe: (type: string, handler: MessageHandler) => () => void;
  isConnected: boolean;
  connectionId: number; // Incremented on each reconnect to trigger re-subscriptions
  reconnect: () => void; // Manual reconnect function
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

const PING_INTERVAL = 15000; // Send ping every 30 seconds
const PONG_TIMEOUT = 5000; // Expect pong within 10 seconds

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
  // Track if component is mounted to prevent reconnects after unmount
  const isMountedRef = useRef(true);

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

    // Don't connect if already connected or connecting
    // CRITICAL: Must check CONNECTING state to prevent race condition where
    // multiple WebSocket connections are created during fast re-renders
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
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
      // Only auto-reconnect if still mounted
      // This prevents reconnect attempts after component unmount
      if (!isMountedRef.current) {
        return;
      }
      // Auto-reconnect with faster initial attempts, then exponential backoff
      // First 3 attempts: 100ms, 200ms, 400ms. Then exponential up to 5 seconds.
      const delay = reconnectAttempts.current < 3
        ? 100 * Math.pow(2, reconnectAttempts.current)
        : Math.min(1000 * Math.pow(1.5, reconnectAttempts.current - 3), 5000);
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
    isMountedRef.current = true;
    connect();

    // Reconnect when tab becomes visible (helps after hot reload or sleep)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isMountedRef.current) {
        // If not connected, attempt immediate reconnect
        if (wsRef.current?.readyState !== WebSocket.OPEN &&
            wsRef.current?.readyState !== WebSocket.CONNECTING) {
          reconnectAttempts.current = 0; // Reset for fast reconnect
          connect();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // Mark as unmounted BEFORE cleanup to prevent reconnects
      isMountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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

  // Manual reconnect - closes existing connection and reconnects immediately
  const reconnect = useCallback(() => {
    reconnectAttempts.current = 0;
    if (wsRef.current) {
      wsRef.current.close();
    }
    // Small delay to ensure close completes
    setTimeout(() => connect(), 50);
  }, [connect]);

  return (
    <WebSocketContext.Provider value={{ send, subscribe, isConnected, connectionId, reconnect }}>
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
