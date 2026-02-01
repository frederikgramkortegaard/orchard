import { useState, useCallback, useEffect, useRef } from 'react';
import { Send, Loader2, Bot, XCircle, MessageCircle } from 'lucide-react';
import { useChatStore } from '../../stores/chat.store';

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
  const isAtBottomRef = useRef(true);

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

  // Track scroll position to determine if user is at bottom
  useEffect(() => {
    const chatEl = chatRef.current;
    if (!chatEl) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = chatEl;
      // Consider "at bottom" if within 50px of the bottom
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
    };

    chatEl.addEventListener('scroll', handleScroll);
    return () => chatEl.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll to bottom when new messages arrive, but only if user is at bottom
  useEffect(() => {
    if (chatRef.current && isAtBottomRef.current) {
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
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setIsSending(false);
    }
  }, [inputText, orchestratorSessionId, projectId, addMessage]);

  return (
    <div className="flex flex-col h-full bg-zinc-900 rounded-lg overflow-hidden shadow-sm">
      {/* Chat header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-zinc-800 text-white border-b border-zinc-700">
        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
          <MessageCircle size={20} />
        </div>
        <div className="flex-1">
          <div className="font-medium text-sm">Orchestrator</div>
          <div className="text-xs text-zinc-400">
            {orchestratorSessionId ? 'Online' : 'Messages will queue'}
          </div>
        </div>
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            orchestratorSessionId ? 'bg-green-500' : 'bg-zinc-500'
          }`}
        />
      </div>

      {/* Chat messages */}
      <div
        ref={chatRef}
        className="flex-1 overflow-y-auto p-3 space-y-1 bg-zinc-900"
      >
        {chatMessages.length === 0 ? (
          <div className="text-xs text-zinc-400 text-center py-8 bg-zinc-800/80 rounded-lg mx-auto max-w-xs shadow-sm">
            <Bot size={24} className="mx-auto mb-2 text-blue-500" />
            No messages yet. Send a message to the orchestrator.
          </div>
        ) : (
          chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`relative max-w-[85%] px-3 py-2 text-sm shadow-sm ${
                  msg.from === 'user'
                    ? 'bg-blue-600 text-white rounded-tl-xl rounded-tr-sm rounded-bl-xl rounded-br-xl'
                    : 'bg-zinc-700 text-zinc-100 rounded-tl-sm rounded-tr-xl rounded-bl-xl rounded-br-xl'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                <p className={`text-[10px] mt-1 text-right ${
                  msg.from === 'user' ? 'text-blue-200' : 'text-zinc-400'
                }`}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Clear pending button */}
      {pendingCount > 0 && (
        <div className="flex justify-center px-3 py-2 bg-amber-900/50 border-t border-amber-800/50">
          <button
            onClick={handleClearPending}
            disabled={isClearing}
            className="text-xs text-amber-200 hover:text-amber-100 flex items-center gap-1.5 disabled:opacity-50"
            title="Mark all pending messages as processed"
          >
            <XCircle size={14} />
            {isClearing ? 'Clearing...' : `${pendingCount} pending message${pendingCount > 1 ? 's' : ''} - tap to clear`}
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="flex items-center gap-2 p-2 bg-zinc-800 border-t border-zinc-700">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Type a message"
          className="flex-1 px-4 py-2.5 bg-zinc-700 rounded-full text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm placeholder:text-zinc-400"
          onKeyDown={(e) => e.key === 'Enter' && !isSending && handleSend()}
        />
        <button
          onClick={handleSend}
          disabled={isSending || !inputText.trim()}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shadow-sm ${
            inputText.trim()
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-zinc-600 text-zinc-400'
          } disabled:opacity-50`}
        >
          {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  );
}
