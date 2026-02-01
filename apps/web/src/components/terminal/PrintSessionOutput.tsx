import { useEffect, useRef } from 'react';
import { usePrintSessionStore } from '../../stores/print-session.store';

interface Props {
  projectId: string;
  sessionId: string;
}

export function PrintSessionOutput({ projectId, sessionId }: Props) {
  const { sessions, outputs, startPolling, stopPolling } = usePrintSessionStore();
  const outputRef = useRef<HTMLPreElement>(null);

  const session = sessions.get(sessionId);
  const output = outputs.get(sessionId) || '';

  useEffect(() => {
    startPolling(projectId, sessionId);
    return () => stopPolling(sessionId);
  }, [projectId, sessionId, startPolling, stopPolling]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  if (!session) {
    return <div className="p-4 text-gray-500">Session not found</div>;
  }

  return (
    <div className="h-full flex flex-col bg-gray-900 text-gray-100">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${
            session.status === 'running' ? 'bg-green-500 animate-pulse' :
            session.status === 'completed' ? 'bg-pink-500' : 'bg-red-500'
          }`} />
          <span className="text-sm font-medium">
            {session.status === 'running' ? 'Running...' :
             session.status === 'completed' ? 'Completed' : 'Failed'}
          </span>
        </div>
        <span className="text-xs text-gray-400">
          {new Date(session.startedAt).toLocaleTimeString()}
        </span>
      </div>
      <pre
        ref={outputRef}
        className="flex-1 p-4 overflow-auto font-mono text-sm whitespace-pre-wrap"
      >
        {output || (session.status === 'running' ? 'Waiting for output...' : 'No output')}
      </pre>
    </div>
  );
}
