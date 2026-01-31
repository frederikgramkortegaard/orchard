import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

interface TerminalInstanceProps {
  sessionId: string;
  send: (data: unknown) => void;
  subscribe: (type: string, handler: (data: unknown) => void) => () => void;
  isActive: boolean;
  fontSize?: number;
  readOnly?: boolean;
}

export function TerminalInstance({ sessionId, send, subscribe, isActive, fontSize = 14, readOnly = false }: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const receivedSinceAck = useRef(0);

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
      console.log('WebGL not available, using canvas renderer');
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

  // Subscribe to terminal data
  useEffect(() => {
    const unsubData = subscribe('terminal:data', (msg: any) => {
      if (msg.sessionId === sessionId && terminalRef.current) {
        terminalRef.current.write(msg.data);
        receivedSinceAck.current++;

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
    };
  }, [sessionId, subscribe, send]);

  // Refit when becoming active
  useEffect(() => {
    if (isActive) {
      setTimeout(handleResize, 0);
    }
  }, [isActive, handleResize]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-zinc-900"
      style={{ display: isActive ? 'block' : 'none' }}
    />
  );
}
