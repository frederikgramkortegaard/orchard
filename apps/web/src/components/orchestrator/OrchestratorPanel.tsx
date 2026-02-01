import { useState, useCallback, useEffect, useRef } from 'react';
import { Send, Loader2, Bot, XCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useChatStore } from '../../stores/chat.store';
import { AudioRecorder } from '../audio/AudioRecorder';
import { AudioPlayback } from '../audio/AudioPlayback';
import { useAudioStore } from '../../stores/audio.store';
import { LoadingSpinner } from '../LoadingSpinner';
import { useAutoReadMessages } from '../../hooks/useAutoReadMessages';

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

  // Audio recording state
  const isRecording = useAudioStore((state) => state.recordingState === 'recording');

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
  const updateMessageStatus = useChatStore((state) => state.updateMessageStatus);

  // Auto-read orchestrator messages when enabled
  useAutoReadMessages(chatMessages, {
    projectId,
    onMarkAsRead: (messageId) => updateMessageStatus(projectId, messageId, 'read'),
  });

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

  const sendMessage = useCallback(async (message: string) => {
    if (!message.trim()) return;

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
  }, [orchestratorSessionId, projectId, addMessage]);

  const handleSend = useCallback(() => {
    if (!inputText.trim()) return;
    const message = inputText.trim();
    setInputText('');
    sendMessage(message);
  }, [inputText, sendMessage]);

  // Handle voice transcription
  const handleVoiceTranscription = useCallback((text: string) => {
    sendMessage(text);
  }, [sendMessage]);

  return (
    <div className="flex flex-col h-full bg-zinc-900 overflow-hidden">
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
                    ? 'bg-pink-600 text-white rounded-tl-xl rounded-tr-sm rounded-bl-xl rounded-br-xl'
                    : 'bg-zinc-700 text-zinc-100 rounded-tl-sm rounded-tr-xl rounded-bl-xl rounded-br-xl'
                }`}
              >
                <div className="prose prose-sm prose-invert max-w-none break-words [&_p]:my-0 [&_p:not(:last-child)]:mb-2 [&_ul]:my-1 [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:pl-4 [&_li]:my-0 [&_pre]:my-2 [&_pre]:p-2 [&_pre]:rounded [&_pre]:bg-black/20 [&_code]:text-xs [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-black/20 [&_pre_code]:p-0 [&_pre_code]:bg-transparent [&_a]:text-pink-300 [&_a]:underline [&_strong]:font-semibold [&_em]:italic [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-500 [&_blockquote]:pl-2 [&_blockquote]:my-2 [&_blockquote]:italic">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
                <div className={`flex items-center gap-1.5 mt-1 ${
                  msg.from === 'user' ? 'justify-end' : 'justify-start'
                }`}>
                  {msg.from === 'orchestrator' && (
                    <AudioPlayback text={msg.text} messageId={msg.id} />
                  )}
                  <span className={`text-[10px] ${
                    msg.from === 'user' ? 'text-pink-200' : 'text-zinc-500'
                  }`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Clear pending button */}
      {pendingCount > 0 && (
        <div className="flex justify-center px-3 py-2 bg-zinc-800/50 border-t border-zinc-700/50">
          <button
            onClick={handleClearPending}
            disabled={isClearing}
            className="text-xs text-zinc-300 hover:text-zinc-100 flex items-center gap-1.5 disabled:opacity-50"
            title="Mark all pending messages as processed"
          >
            {isClearing ? (
              <>
                <LoadingSpinner size="sm" />
                ✨ Clearing... 💖
              </>
            ) : (
              <>
                <XCircle size={14} />
                💖 {pendingCount} pending message{pendingCount > 1 ? 's' : ''} - tap to clear ✨
              </>
            )}
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
          className={`flex-1 px-4 py-2.5 bg-zinc-700 rounded-full text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm placeholder:text-zinc-400 ${isRecording ? 'hidden' : ''}`}
          onKeyDown={(e) => e.key === 'Enter' && !isSending && handleSend()}
        />
        <div className={isRecording ? 'flex-1 flex justify-center' : ''}>
          <AudioRecorder
            onTranscription={handleVoiceTranscription}
            disabled={isSending}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={isSending || !inputText.trim()}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shadow-sm ${
            inputText.trim()
              ? 'bg-pink-600 hover:bg-pink-500 text-white'
              : 'bg-zinc-600 text-zinc-400'
          } disabled:opacity-50 ${isRecording ? 'hidden' : ''}`}
        >
          {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  );
}
