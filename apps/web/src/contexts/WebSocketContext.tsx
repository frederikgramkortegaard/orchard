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
  // Track if component is mounted to prevent reconnects after unmount
  const isMountedRef = useRef(true);
  // Track if page is unloading to prevent reconnects during refresh
  const isUnloadingRef = useRef(false);

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
    // Don't connect if page is unloading (prevents reconnects during refresh)
    if (isUnloadingRef.current) {
      return;
    }

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Don't connect if already connected, connecting, or closing
    // CRITICAL: Must check CONNECTING and CLOSING states to prevent race conditions
    const currentState = wsRef.current?.readyState;
    if (currentState === WebSocket.OPEN ||
        currentState === WebSocket.CONNECTING ||
        currentState === WebSocket.CLOSING) {
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
      // Only auto-reconnect if still mounted and not unloading
      // This prevents reconnect attempts after component unmount or during page refresh
      if (!isMountedRef.current || isUnloadingRef.current) {
        return;
      }
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

  // Store connect in a ref to avoid useEffect dependency issues
  const connectRef = useRef(connect);
  connectRef.current = connect;

  useEffect(() => {
    isMountedRef.current = true;
    isUnloadingRef.current = false;
    connectRef.current();

    // Handle page visibility changes - reconnect when page becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isMountedRef.current && !isUnloadingRef.current) {
        // Check if connection is stale or closed
        const currentState = wsRef.current?.readyState;
        if (currentState !== WebSocket.OPEN && currentState !== WebSocket.CONNECTING) {
          // Reset reconnect attempts for immediate reconnection
          reconnectAttempts.current = 0;
          connectRef.current();
        }
      }
    };

    // Handle page unload - prevent reconnection attempts during refresh
    const handleBeforeUnload = () => {
      isUnloadingRef.current = true;
      // Clear any pending reconnect timers
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      // Mark as unmounted BEFORE cleanup to prevent reconnects
      isMountedRef.current = false;
      clearPingPong();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      wsRef.current?.close();
    };
  }, [clearPingPong]);

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
