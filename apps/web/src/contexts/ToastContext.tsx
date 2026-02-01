import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  operation?: string;
  details?: string;
  action?: ToastAction;
}

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  operation?: string;
  details?: string;
  action?: ToastAction;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, options?: ToastOptions) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string, options?: ToastOptions) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const toast: Toast = {
      id,
      type,
      message,
      operation: options?.operation,
      details: options?.details,
      action: options?.action,
    };

    setToasts((prev) => [...prev, toast]);

    // Auto-dismiss after 5 seconds (longer for toasts with details or actions)
    const dismissMs = (options?.details || options?.action) ? AUTO_DISMISS_MS * 2 : AUTO_DISMISS_MS;
    setTimeout(() => {
      removeToast(id);
    }, dismissMs);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
