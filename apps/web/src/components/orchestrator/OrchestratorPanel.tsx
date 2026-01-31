import { useState, useCallback, useEffect } from 'react';
import { Radio, Send, Loader2 } from 'lucide-react';

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

export function OrchestratorPanel({ projectId, projectPath }: OrchestratorPanelProps) {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [orchestratorSessionId, setOrchestratorSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Find orchestrator session on mount and poll for it
  useEffect(() => {
    const findOrchestratorSession = async () => {
      try {
        const orchestratorWorktreeId = `orchestrator-${projectId}`;
        const res = await fetch(`/api/terminals/worktree/${encodeURIComponent(orchestratorWorktreeId)}`);
        if (res.ok) {
          const sessions: TerminalSession[] = await res.json();
          if (sessions.length > 0) {
            setOrchestratorSessionId(sessions[0].id);
          }
        }
      } catch (err) {
        // Ignore errors
      }
    };

    findOrchestratorSession();
    const interval = setInterval(findOrchestratorSession, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || !orchestratorSessionId) return;

    setIsSending(true);
    setStatus('idle');
    try {
      const res = await fetch(`/api/terminals/${orchestratorSessionId}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputText, sendEnter: true }),
      });

      if (res.ok) {
        setStatus('success');
        setInputText('');
        // Reset status after a moment
        setTimeout(() => setStatus('idle'), 2000);
      } else {
        setStatus('error');
      }
    } catch (err) {
      setStatus('error');
    } finally {
      setIsSending(false);
    }
  }, [inputText, orchestratorSessionId]);

  const isDisabled = !orchestratorSessionId || isSending;

  return (
    <div className="flex items-center gap-2 p-2 bg-zinc-800 rounded-lg border border-zinc-700">
      <div
        className={`flex items-center justify-center w-8 h-8 rounded ${
          orchestratorSessionId
            ? status === 'success'
              ? 'bg-green-900/50 text-green-400'
              : status === 'error'
              ? 'bg-red-900/50 text-red-400'
              : 'bg-amber-900/30 text-amber-400'
            : 'bg-zinc-700 text-zinc-500'
        }`}
        title={orchestratorSessionId ? 'Orchestrator connected' : 'Looking for orchestrator...'}
      >
        <Radio size={16} className={isSending ? 'animate-pulse' : ''} />
      </div>
      <input
        type="text"
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        placeholder={orchestratorSessionId ? 'Message to orchestrator...' : 'Waiting for orchestrator...'}
        className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm focus:outline-none focus:border-amber-500 placeholder:text-zinc-500 disabled:opacity-50"
        onKeyDown={(e) => e.key === 'Enter' && !isDisabled && handleSend()}
        disabled={isDisabled}
      />
      <button
        onClick={handleSend}
        disabled={isDisabled || !inputText.trim()}
        className="px-3 py-2 bg-amber-600 hover:bg-amber-500 rounded text-sm disabled:opacity-50 flex items-center"
        title="Send to orchestrator"
      >
        {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
      </button>
    </div>
  );
}
