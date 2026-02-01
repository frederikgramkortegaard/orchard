import { useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '../stores/settings.store';
import { useAudioStore } from '../stores/audio.store';
import { useSpeechSynthesis } from './useSpeechSynthesis';

interface Message {
  id: string;
  text: string;
  from: 'user' | 'orchestrator';
  timestamp: string;
  status?: 'unread' | 'read' | 'working' | 'resolved';
}

interface UseAutoReadMessagesOptions {
  projectId: string;
  onMarkAsRead?: (messageId: string) => void;
}

/**
 * Hook to auto-read orchestrator messages in sequence.
 * Only reads the next message after the previous one finishes.
 * Marks messages as 'read' after they've been spoken.
 */
export function useAutoReadMessages(messages: Message[], options: UseAutoReadMessagesOptions) {
  const { projectId, onMarkAsRead } = options;
  const autoReadMessages = useSettingsStore((state) => state.autoReadMessages);
  const playbackState = useAudioStore((state) => state.playbackState);
  const currentlyPlayingMessageId = useAudioStore((state) => state.currentlyPlayingMessageId);
  const { speak, isSupported } = useSpeechSynthesis();

  // Track which messages we've already queued for reading
  const queuedMessageIds = useRef<Set<string>>(new Set());
  // Queue of messages waiting to be read
  const messageQueue = useRef<Message[]>([]);
  // Whether we're currently reading from the queue
  const isProcessingQueue = useRef(false);
  // Track the last message we started reading
  const lastReadMessageId = useRef<string | null>(null);

  // Mark a message as read via API
  const markAsRead = useCallback(async (messageId: string) => {
    try {
      await fetch(`/api/chat/${messageId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, status: 'read' }),
      });
      onMarkAsRead?.(messageId);
    } catch (err) {
      console.error('Failed to mark message as read:', err);
    }
  }, [projectId, onMarkAsRead]);

  // Process the queue when playback stops
  const processQueue = useCallback(() => {
    if (!autoReadMessages || !isSupported) return;

    // Mark the last read message as 'read' when it finishes
    if (lastReadMessageId.current) {
      markAsRead(lastReadMessageId.current);
      lastReadMessageId.current = null;
    }

    if (messageQueue.current.length === 0) {
      isProcessingQueue.current = false;
      return;
    }

    isProcessingQueue.current = true;
    const nextMessage = messageQueue.current.shift();
    if (nextMessage) {
      lastReadMessageId.current = nextMessage.id;
      speak(nextMessage.text, nextMessage.id);
    }
  }, [autoReadMessages, isSupported, speak, markAsRead]);

  // Watch for playback state changes - when idle, process next in queue
  useEffect(() => {
    if (playbackState === 'idle' && isProcessingQueue.current) {
      // Small delay to avoid rapid-fire reading
      const timeout = setTimeout(processQueue, 300);
      return () => clearTimeout(timeout);
    }
  }, [playbackState, processQueue]);

  // Watch for new orchestrator messages
  useEffect(() => {
    if (!autoReadMessages || !isSupported) return;

    // Find new orchestrator messages that:
    // 1. Haven't been queued yet
    // 2. Are from the orchestrator
    // 3. Haven't been marked as 'read' or 'resolved' (only read unread messages)
    const newMessages = messages.filter(
      (msg) =>
        msg.from === 'orchestrator' &&
        !queuedMessageIds.current.has(msg.id) &&
        (msg.status === 'unread' || !msg.status)
    );

    if (newMessages.length === 0) return;

    // Mark them as queued and add to queue
    newMessages.forEach((msg) => {
      queuedMessageIds.current.add(msg.id);
      messageQueue.current.push(msg);
    });

    // If not currently processing, start
    if (!isProcessingQueue.current && playbackState === 'idle') {
      processQueue();
    }
  }, [messages, autoReadMessages, isSupported, playbackState, processQueue]);

  // Reset tracking when auto-read is disabled
  useEffect(() => {
    if (!autoReadMessages) {
      messageQueue.current = [];
      isProcessingQueue.current = false;
    }
  }, [autoReadMessages]);

  // Clear queued message IDs when messages list changes significantly (e.g., project switch)
  const lastMessageCount = useRef(messages.length);
  useEffect(() => {
    // If message count dropped significantly, it's likely a project switch
    if (messages.length < lastMessageCount.current - 10) {
      queuedMessageIds.current.clear();
      messageQueue.current = [];
      isProcessingQueue.current = false;
      lastReadMessageId.current = null;
    }
    lastMessageCount.current = messages.length;
  }, [messages.length]);
}
