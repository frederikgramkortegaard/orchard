import { useState, useCallback, useEffect, useRef } from 'react';
import { Radio, Send, Loader2, MessageSquare } from 'lucide-react';

interface OrchestratorPanelProps {
  projectId: string;
  projectPath: string;
}

interface TerminalSession {
  id: string;
  worktreeId: string;
  cwd: string;
  createdAt: string;
}

interface QueuedMessage {
  id: string;
  text: string;
  timestamp: Date;
}

export function OrchestratorPanel({ projectId, projectPath }: OrchestratorPanelProps) {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [orchestratorSessionId, setOrchestratorSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'queued'>('idle');
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const queueRef = useRef<QueuedMessage[]>([]);

  // Keep ref in sync with state for use in interval
  useEffect(() => {
    queueRef.current = messageQueue;
  }, [messageQueue]);

  // Find orchestrator session on mount and poll for it
  useEffect(() => {
    const findOrchestratorSession = async () => {
      try {
        const orchestratorWorktreeId = `orchestrator-${projectId}`;
        const res = await fetch(`/api/terminals/worktree/${encodeURIComponent(orchestratorWorktreeId)}`);
        if (res.ok) {
          const sessions: TerminalSession[] = await res.json();
          if (sessions.length > 0) {
            const sessionId = sessions[0].id;
            setOrchestratorSessionId(sessionId);

            // Send any queued messages
            if (queueRef.current.length > 0) {
              for (const msg of queueRef.current) {
                try {
                  await fetch(`/api/terminals/${sessionId}/input`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ input: msg.text, sendEnter: true }),
                  });
                } catch {
                  // Ignore individual message errors
                }
              }
              setMessageQueue([]);
              setStatus('success');
              setTimeout(() => setStatus('idle'), 2000);
            }
          }
        }
      } catch (err) {
        // Ignore errors
      }
    };

    findOrchestratorSession();
    const interval = setInterval(findOrchestratorSession, 3000);
    return () => clearInterval(interval);
  }, [projectId]);

  const handleSend = useCallback(async () => {
    if (!inputText.trim()) return;

    const message = inputText.trim();
    setInputText('');

    if (orchestratorSessionId) {
      // Send directly
      setIsSending(true);
      setStatus('idle');
      try {
        const res = await fetch(`/api/terminals/${orchestratorSessionId}/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: message, sendEnter: true }),
        });

        if (res.ok) {
          setStatus('success');
          setTimeout(() => setStatus('idle'), 2000);
        } else {
          setStatus('error');
        }
      } catch (err) {
        setStatus('error');
      } finally {
        setIsSending(false);
      }
    } else {
      // Queue the message on the server
      try {
        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, text: message }),
        });
        if (res.ok) {
          const data = await res.json();
          setMessageQueue(prev => [...prev, { id: data.message.id, text: message, timestamp: new Date() }]);
          setStatus('queued');
          setTimeout(() => setStatus('idle'), 1000);
        } else {
          setStatus('error');
        }
      } catch {
        setStatus('error');
      }
    }
  }, [inputText, orchestratorSessionId]);

  return (
    <div className="flex items-center gap-2 p-2 bg-zinc-200 dark:bg-zinc-800 rounded-lg border border-zinc-300 dark:border-zinc-700">
      <div
        className={`flex items-center justify-center w-8 h-8 rounded relative ${
          orchestratorSessionId
            ? status === 'success'
              ? 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400'
              : status === 'error'
              ? 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400'
              : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
            : status === 'queued'
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
            : 'bg-zinc-300 dark:bg-zinc-700 text-zinc-500'
        }`}
        title={orchestratorSessionId ? 'Orchestrator connected' : messageQueue.length > 0 ? `${messageQueue.length} messages queued` : 'Orchestrator not connected - messages will be queued'}
      >
        <Radio size={16} className={isSending ? 'animate-pulse' : ''} />
        {messageQueue.length > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-xs rounded-full flex items-center justify-center">
            {messageQueue.length}
          </span>
        )}
      </div>
      <input
        type="text"
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        placeholder={orchestratorSessionId ? 'Message to orchestrator...' : 'Message (will be queued)...'}
        className="flex-1 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded text-sm focus:outline-none focus:border-amber-500 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
        onKeyDown={(e) => e.key === 'Enter' && !isSending && handleSend()}
      />
      <button
        onClick={handleSend}
        disabled={isSending || !inputText.trim()}
        className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm disabled:opacity-50 flex items-center"
        title={orchestratorSessionId ? 'Send to orchestrator' : 'Queue message'}
      >
        {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
      </button>
    </div>
  );
}
