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
    <div className="flex flex-col h-full bg-zinc-200 dark:bg-zinc-800 rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden">
      {/* Chat header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-300 dark:border-zinc-700">
        <div
          className={`w-2 h-2 rounded-full ${
            orchestratorSessionId ? 'bg-green-500' : 'bg-zinc-400'
          }`}
        />
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {orchestratorSessionId ? 'Connected' : 'Messages will queue'}
        </span>
      </div>

      {/* Chat messages */}
      <div
        ref={chatRef}
        className="flex-1 overflow-y-auto p-2 space-y-2"
      >
        {chatMessages.length === 0 ? (
          <div className="text-xs text-zinc-500 text-center py-4">
            No messages yet. Send a message to the orchestrator.
          </div>
        ) : (
          chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.from === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.from === 'orchestrator' && (
                <div className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center flex-shrink-0">
                  <Bot size={14} className="text-amber-600 dark:text-amber-400" />
                </div>
              )}
              <div
                className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                  msg.from === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                <p className={`text-xs mt-1 ${msg.from === 'user' ? 'text-blue-200' : 'text-zinc-400'}`}>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </p>
              </div>
              {msg.from === 'user' && (
                <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center flex-shrink-0">
                  <User size={14} className="text-blue-600 dark:text-blue-400" />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Clear pending button */}
      {pendingCount > 0 && (
        <div className="flex justify-end px-2 py-1 bg-zinc-100 dark:bg-zinc-900 border-t border-zinc-300 dark:border-zinc-700">
          <button
            onClick={handleClearPending}
            disabled={isClearing}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 flex items-center gap-1 disabled:opacity-50"
            title="Mark all pending messages as processed"
          >
            <XCircle size={12} />
            {isClearing ? 'Clearing...' : `Clear ${pendingCount} pending`}
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="flex items-center gap-2 p-2 bg-zinc-100 dark:bg-zinc-900 border-t border-zinc-300 dark:border-zinc-700">
        <div
          className={`flex items-center justify-center w-8 h-8 rounded ${
            status === 'success'
              ? 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400'
              : status === 'error'
              ? 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400'
              : orchestratorSessionId
              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
              : 'bg-zinc-300 dark:bg-zinc-700 text-zinc-500'
          }`}
        >
          <Radio size={16} className={isSending ? 'animate-pulse' : ''} />
        </div>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Message..."
          className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-sm focus:outline-none focus:border-amber-500 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          onKeyDown={(e) => e.key === 'Enter' && !isSending && handleSend()}
        />
        <button
          onClick={handleSend}
          disabled={isSending || !inputText.trim()}
          className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm disabled:opacity-50 flex items-center"
        >
          {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}
