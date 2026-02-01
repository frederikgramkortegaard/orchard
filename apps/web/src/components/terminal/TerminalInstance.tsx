import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Clock } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import type { RateLimitStatus } from '../../stores/terminal.store';
import { useTerminalStore } from '../../stores/terminal.store';

// Patterns that indicate Claude is waiting for user input
const WAITING_PATTERNS = [
  /\?\s*$/,                        // Ends with question mark
  /\[Y\/n\]/i,                     // Yes/No prompt
  /\(y\/n\)/i,                     // Yes/No prompt
  /press enter/i,                  // Press enter prompt
  /continue\?/i,                   // Continue prompt
  /waiting for input/i,            // Explicit waiting message
  /❯\s*$/,                         // Claude Code prompt
];

interface TerminalInstanceProps {
  sessionId: string;
  send: (data: unknown) => void;
  subscribe: (type: string, handler: (data: unknown) => void) => () => void;
  isActive: boolean;
  fontSize?: number;
  readOnly?: boolean;
  rateLimit?: RateLimitStatus;
  connectionId?: number; // Triggers re-subscription when connection is restored
}

export function TerminalInstance({ sessionId, send, subscribe, isActive, fontSize = 14, readOnly = false, rateLimit, connectionId }: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const receivedSinceAck = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOutputRef = useRef<string>('');
  const { setSessionActivity } = useTerminalStore();

  const IDLE_TIMEOUT = 3000; // 3 seconds of no output = idle

  // Check if output indicates waiting for input
  const checkForWaitingState = useCallback((data: string) => {
    // Accumulate recent output to check patterns
    lastOutputRef.current = (lastOutputRef.current + data).slice(-500);

    for (const pattern of WAITING_PATTERNS) {
      if (pattern.test(lastOutputRef.current)) {
        return true;
      }
    }
    return false;
  }, []);

  // Update activity status when output is received
  const handleOutputActivity = useCallback((data: string) => {
    const now = Date.now();

    // Clear existing idle timer
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }

    // Check if waiting for input
    const isWaiting = checkForWaitingState(data);

    if (isWaiting) {
      setSessionActivity(sessionId, 'waiting', now);
    } else {
      setSessionActivity(sessionId, 'running', now);
    }

    // Set timer to transition to idle after timeout
    idleTimerRef.current = setTimeout(() => {
      // Re-check if still waiting (pattern might still match)
      if (checkForWaitingState('')) {
        setSessionActivity(sessionId, 'waiting');
      } else {
        setSessionActivity(sessionId, 'idle');
      }
    }, IDLE_TIMEOUT);
  }, [sessionId, setSessionActivity, checkForWaitingState]);

  const handleResize = useCallback(() => {
    if (fitAddonRef.current && terminalRef.current && isActive) {
      fitAddonRef.current.fit();
      send({
        type: 'terminal:resize',
        sessionId,
        cols: terminalRef.current.cols,
        rows: terminalRef.current.rows,
      });
    }
  }, [sessionId, send, isActive]);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: !readOnly,
      disableStdin: readOnly,
      fontSize,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#18181b',
        foreground: '#fafafa',
        cursor: readOnly ? '#3f3f46' : '#fafafa',
        cursorAccent: '#18181b',
        selectionBackground: '#3f3f46',
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(containerRef.current);

    // Try WebGL for better performance
    try {
      const webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available, using canvas renderer
    }

    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Subscribe to session
    send({ type: 'terminal:subscribe', sessionId });

    // Handle terminal input (disabled for read-only terminals)
    if (!readOnly) {
      terminal.onData((data) => {
        send({ type: 'terminal:input', sessionId, data });
      });
    }

    // Send initial resize
    send({
      type: 'terminal:resize',
      sessionId,
      cols: terminal.cols,
      rows: terminal.rows,
    });

    // Handle window resize
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      send({ type: 'terminal:unsubscribe', sessionId });
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, [sessionId, send]);

  // Re-subscribe when WebSocket connects or reconnects (connectionId changes)
  useEffect(() => {
    // Skip before first connection (connectionId starts at 0, becomes 1+ after connect)
    if (connectionId === undefined || connectionId === 0) return;

    // Re-subscribe to session after connection/reconnection
    send({ type: 'terminal:subscribe', sessionId });

    // Re-send resize to ensure terminal dimensions are correct
    if (terminalRef.current) {
      send({
        type: 'terminal:resize',
        sessionId,
        cols: terminalRef.current.cols,
        rows: terminalRef.current.rows,
      });
    }
  }, [connectionId, sessionId, send]);

  // Subscribe to terminal data
  useEffect(() => {
    const unsubData = subscribe('terminal:data', (msg: any) => {
      if (msg.sessionId === sessionId && terminalRef.current) {
        terminalRef.current.write(msg.data);
        receivedSinceAck.current++;

        // Track activity status
        handleOutputActivity(msg.data);

        // Acknowledge every 50 chunks for flow control
        if (receivedSinceAck.current >= 50) {
          send({
            type: 'terminal:ack',
            sessionId,
            count: receivedSinceAck.current,
          });
          receivedSinceAck.current = 0;
        }
      }
    });

    const unsubScrollback = subscribe('terminal:scrollback', (msg: any) => {
      if (msg.sessionId === sessionId && terminalRef.current) {
        terminalRef.current.write(msg.data.join(''));
      }
    });

    const unsubExit = subscribe('terminal:exit', (msg: any) => {
      if (msg.sessionId === sessionId && terminalRef.current) {
        terminalRef.current.write(`\r\n\x1b[31m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
      }
    });

    return () => {
      unsubData();
      unsubScrollback();
      unsubExit();
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, [sessionId, subscribe, send, handleOutputActivity]);

  // Refit when becoming active
  useEffect(() => {
    if (isActive) {
      setTimeout(handleResize, 0);
    }
  }, [isActive, handleResize]);

  // Auto-updating wait time for rate limit display
  const [waitTime, setWaitTime] = useState('');

  useEffect(() => {
    if (!rateLimit?.isLimited || !rateLimit?.detectedAt) {
      setWaitTime('');
      return;
    }

    const updateWaitTime = () => {
      const elapsed = Math.floor((Date.now() - rateLimit.detectedAt!) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      setWaitTime(minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`);
    };

    updateWaitTime();
    const interval = setInterval(updateWaitTime, 1000);
    return () => clearInterval(interval);
  }, [rateLimit?.isLimited, rateLimit?.detectedAt]);

  return (
    <div
      className="h-full w-full bg-zinc-900 relative"
      style={{ display: isActive ? 'block' : 'none' }}
    >
      <div ref={containerRef} className="h-full w-full" />

      {/* Rate limit overlay */}
      {rateLimit?.isLimited && (
        <div className="absolute inset-0 bg-zinc-900/80 flex items-center justify-center z-10">
          <div className="bg-zinc-800 border border-amber-500/50 rounded-lg p-6 max-w-md text-center">
            <div className="flex items-center justify-center gap-2 text-amber-500 mb-3">
              <Clock size={24} className="animate-pulse" />
              <span className="text-lg font-semibold">Session Paused</span>
            </div>
            <p className="text-zinc-300 text-sm mb-2">
              Claude has hit a rate limit and is waiting to resume.
            </p>
            {rateLimit.message && (
              <p className="text-zinc-400 text-xs bg-zinc-900 rounded p-2 mb-2 max-h-20 overflow-auto">
                {rateLimit.message}
              </p>
            )}
            <p className="text-zinc-500 text-xs">
              Waiting: {waitTime}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
