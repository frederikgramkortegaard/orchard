import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';

type MessageHandler = (data: unknown) => void;

interface WebSocketContextValue {
  send: (data: unknown) => void;
  subscribe: (type: string, handler: MessageHandler) => () => void;
  isConnected: boolean;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttempts = useRef(0);

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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttempts.current = 0;
    };

    ws.onclose = () => {
      setIsConnected(false);
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
        const handlers = handlersRef.current.get(data.type);
        if (handlers) {
          handlers.forEach((handler) => handler(data));
        }
      } catch (err) {
        console.error('WebSocket message parse error:', err);
      }
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

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
    <WebSocketContext.Provider value={{ send, subscribe, isConnected }}>
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
