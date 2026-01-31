import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatMessage {
  id: string;
  text: string;
  timestamp: string;
  from: 'user' | 'orchestrator';
  replyTo?: string;
}

interface ChatState {
  // Messages keyed by projectId
  messagesByProject: Record<string, ChatMessage[]>;

  // Actions
  setMessages: (projectId: string, messages: ChatMessage[]) => void;
  addMessage: (projectId: string, message: ChatMessage) => void;
  clearMessages: (projectId: string) => void;
  getMessages: (projectId: string) => ChatMessage[];
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messagesByProject: {},

      setMessages: (projectId, messages) =>
        set((state) => ({
          messagesByProject: {
            ...state.messagesByProject,
            [projectId]: messages,
          },
        })),

      addMessage: (projectId, message) =>
        set((state) => {
          const existing = state.messagesByProject[projectId] || [];
          // Avoid duplicates by checking id
          if (existing.some((m) => m.id === message.id)) {
            return state;
          }
          return {
            messagesByProject: {
              ...state.messagesByProject,
              [projectId]: [...existing, message],
            },
          };
        }),

      clearMessages: (projectId) =>
        set((state) => ({
          messagesByProject: {
            ...state.messagesByProject,
            [projectId]: [],
          },
        })),

      getMessages: (projectId) => get().messagesByProject[projectId] || [],
    }),
    {
      name: 'orchard-chat-store',
      // Persist all messages for hot reload resilience
      partialize: (state) => ({
        messagesByProject: state.messagesByProject,
      }),
    }
  )
);
