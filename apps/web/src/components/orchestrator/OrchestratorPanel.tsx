import { useState, useCallback, useEffect, useRef } from 'react';
import { Radio, Send, Loader2, User, Bot, XCircle } from 'lucide-react';
import { useChatStore, ChatMessage } from '../../stores/chat.store';

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
  const [isClearing, setIsClearing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [orchestratorSessionId, setOrchestratorSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleClearPending = async () => {
    setIsClearing(true);
    try {
      await fetch('/api/orchestrator/loop/clear-pending', { method: 'POST' });
      setPendingCount(0);
    } catch (err) {
      console.error('Failed to clear pending messages:', err);
    } finally {
      setIsClearing(false);
    }
  };

  // Poll for pending count
  useEffect(() => {
    const fetchPendingCount = async () => {
      try {
        const res = await fetch('/api/orchestrator/loop/pending-count');
        if (res.ok) {
          const data = await res.json();
          setPendingCount(data.count);
        }
      } catch {
        // Ignore errors
      }
    };
    fetchPendingCount();
    const interval = setInterval(fetchPendingCount, 5000);
    return () => clearInterval(interval);
  }, []);
  const chatRef = useRef<HTMLDivElement>(null);

  // Use persisted chat store instead of local state
  const chatMessages = useChatStore((state) => state.getMessages(projectId));
  const setMessages = useChatStore((state) => state.setMessages);
  const addMessage = useChatStore((state) => state.addMessage);

  // Load chat history on mount and poll for updates
  useEffect(() => {
    const loadChat = async () => {
      try {
        const res = await fetch(`/api/chat?projectId=${projectId}&limit=100`);
        if (res.ok) {
          const messages = await res.json();
          setMessages(projectId, messages);
        }
      } catch {
        // Ignore errors
      }
    };
    loadChat();
    const interval = setInterval(loadChat, 3000);
    return () => clearInterval(interval);
  }, [projectId, setMessages]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [chatMessages]);

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
          } else {
            setOrchestratorSessionId(null);
          }
        }
      } catch {
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
    setIsSending(true);
    setStatus('idle');

    try {
      // Always save to chat history
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, text: message, from: 'user' }),
      });

      if (chatRes.ok) {
        const data = await chatRes.json();
        addMessage(projectId, data.message);
      }

      // If orchestrator is connected, also send to terminal
      if (orchestratorSessionId) {
        await fetch(`/api/terminals/${orchestratorSessionId}/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: message, sendEnter: true }),
        });
      }

      setStatus('success');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      setStatus('error');
    } finally {
      setIsSending(false);
    }
  }, [inputText, orchestratorSessionId, projectId, addMessage]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-800 rounded-xl border border-zinc-200 dark:border-neutral-700 overflow-hidden shadow-sm">
      {/* Chat header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-neutral-900/50 border-b border-zinc-100 dark:border-neutral-700">
        <div
          className={`w-1.5 h-1.5 rounded-full ${
            orchestratorSessionId ? 'bg-emerald-400' : 'bg-zinc-300 dark:bg-zinc-600'
          }`}
        />
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          {orchestratorSessionId ? 'Connected' : 'Messages will queue'}
        </span>
      </div>

      {/* Chat messages */}
      <div
        ref={chatRef}
        className="flex-1 overflow-y-auto p-3 space-y-3"
      >
        {chatMessages.length === 0 ? (
          <div className="text-xs text-zinc-400 dark:text-zinc-500 text-center py-6">
            Send a message to the orchestrator
          </div>
        ) : (
          chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.from === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
            >
              {msg.from === 'orchestrator' && (
                <div className="w-6 h-6 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                  <Bot size={12} className="text-amber-600 dark:text-amber-400" />
                </div>
              )}
              <div
                className={`max-w-[85%] px-3 py-2 text-[13px] leading-relaxed ${
                  msg.from === 'user'
                    ? 'bg-blue-500 text-white rounded-2xl rounded-br-md'
                    : 'bg-zinc-100 dark:bg-neutral-700 text-zinc-700 dark:text-zinc-200 rounded-2xl rounded-bl-md'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                <p className={`text-[10px] mt-1 ${msg.from === 'user' ? 'text-blue-200' : 'text-zinc-400 dark:text-zinc-500'}`}>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </p>
              </div>
              {msg.from === 'user' && (
                <div className="w-6 h-6 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                  <User size={12} className="text-blue-600 dark:text-blue-400" />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Clear pending button */}
      {pendingCount > 0 && (
        <div className="flex justify-end px-3 py-1.5 bg-zinc-50 dark:bg-neutral-900/50 border-t border-zinc-100 dark:border-neutral-700">
          <button
            onClick={handleClearPending}
            disabled={isClearing}
            className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex items-center gap-1 disabled:opacity-50 transition-colors"
            title="Mark all pending messages as processed"
          >
            <XCircle size={11} />
            {isClearing ? 'Clearing...' : `Clear ${pendingCount} pending`}
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="flex items-center gap-2 p-2 bg-zinc-50 dark:bg-neutral-900/50 border-t border-zinc-100 dark:border-neutral-700">
        <div
          className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
            status === 'success'
              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
              : status === 'error'
              ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
              : orchestratorSessionId
              ? 'bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
              : 'bg-zinc-100 dark:bg-neutral-700 text-zinc-400'
          }`}
        >
          <Radio size={14} className={isSending ? 'animate-pulse' : ''} />
        </div>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Message..."
          className="flex-1 px-3 py-1.5 bg-white dark:bg-neutral-800 border border-zinc-200 dark:border-neutral-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 transition-all"
          onKeyDown={(e) => e.key === 'Enter' && !isSending && handleSend()}
        />
        <button
          onClick={handleSend}
          disabled={isSending || !inputText.trim()}
          className="p-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg disabled:opacity-40 flex items-center shadow-sm hover:shadow-md transition-all"
        >
          {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
}
