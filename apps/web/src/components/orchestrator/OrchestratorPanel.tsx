import { useState, useCallback, useEffect, useRef } from 'react';
import { Radio, Send, Loader2, User, Bot } from 'lucide-react';

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

interface ChatMessage {
  id: string;
  text: string;
  timestamp: string;
  from: 'user' | 'orchestrator';
  replyTo?: string;
}

export function OrchestratorPanel({ projectId, projectPath }: OrchestratorPanelProps) {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [orchestratorSessionId, setOrchestratorSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);

  // Load chat history on mount and poll for updates
  useEffect(() => {
    const loadChat = async () => {
      try {
        const res = await fetch(`/api/chat?projectId=${projectId}&limit=100`);
        if (res.ok) {
          const messages = await res.json();
          setChatMessages(messages);
        }
      } catch {
        // Ignore errors
      }
    };
    loadChat();
    const interval = setInterval(loadChat, 3000);
    return () => clearInterval(interval);
  }, [projectId]);

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
        setChatMessages(prev => [...prev, data.message]);
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
  }, [inputText, orchestratorSessionId, projectId]);

  return (
    <div className="flex flex-col h-full bg-zinc-200 dark:bg-zinc-800 pink:bg-pink-200 rounded-lg border border-zinc-300 dark:border-zinc-700 pink:border-pink-300 overflow-hidden">
      {/* Chat header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-900 pink:bg-pink-100 border-b border-zinc-300 dark:border-zinc-700 pink:border-pink-300">
        <div
          className={`w-2 h-2 rounded-full ${
            orchestratorSessionId ? 'bg-green-500' : 'bg-zinc-400'
          }`}
        />
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400 pink:text-pink-600">
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

      {/* Input area */}
      <div className="flex items-center gap-2 p-2 bg-zinc-100 dark:bg-zinc-900 pink:bg-pink-100 border-t border-zinc-300 dark:border-zinc-700 pink:border-pink-300">
        <div
          className={`flex items-center justify-center w-8 h-8 rounded ${
            status === 'success'
              ? 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400'
              : status === 'error'
              ? 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400'
              : orchestratorSessionId
              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
              : 'bg-zinc-300 dark:bg-zinc-700 pink:bg-pink-300 text-zinc-500 pink:text-pink-500'
          }`}
        >
          <Radio size={16} className={isSending ? 'animate-pulse' : ''} />
        </div>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Message..."
          className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 pink:bg-pink-50 border border-zinc-300 dark:border-zinc-700 pink:border-pink-300 rounded text-sm focus:outline-none focus:border-amber-500 pink:focus:border-pink-500 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 pink:placeholder:text-pink-400"
          onKeyDown={(e) => e.key === 'Enter' && !isSending && handleSend()}
        />
        <button
          onClick={handleSend}
          disabled={isSending || !inputText.trim()}
          className="px-3 py-2 bg-amber-600 hover:bg-amber-500 pink:bg-pink-600 pink:hover:bg-pink-500 text-white rounded text-sm disabled:opacity-50 flex items-center"
        >
          {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}
