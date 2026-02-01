import { useState } from 'react';
import { X, CheckCircle, XCircle, AlertTriangle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast, type Toast as ToastType, type ToastType as ToastVariant } from '../contexts/ToastContext';

const iconMap: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle size={18} className="text-green-500" />,
  error: <XCircle size={18} className="text-red-500" />,
  warning: <AlertTriangle size={18} className="text-amber-500" />,
  info: <Info size={18} className="text-blue-500" />,
};

const bgColorMap: Record<ToastVariant, string> = {
  success: 'bg-zinc-100 dark:bg-zinc-800 border-green-400 dark:border-green-600',
  error: 'bg-zinc-100 dark:bg-zinc-800 border-red-400 dark:border-red-600',
  warning: 'bg-zinc-100 dark:bg-zinc-800 border-amber-400 dark:border-amber-600',
  info: 'bg-zinc-100 dark:bg-zinc-800 border-blue-400 dark:border-blue-600',
};

function ToastItem({ toast }: { toast: ToastType }) {
  const { removeToast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);

  const handleDismiss = () => {
    removeToast(toast.id);
  };

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    toast.action?.onClick();
  };

  const toggleDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div
      onClick={handleDismiss}
      className={`flex flex-col gap-2 px-5 py-4 rounded-2xl border-l-4 shadow-xl cursor-pointer backdrop-blur-sm ${bgColorMap[toast.type]} animate-slide-in`}
    >
      <div className="flex items-center gap-3">
        {iconMap[toast.type]}
        <div className="flex-1 min-w-0">
          {toast.operation && (
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {toast.operation}
            </span>
          )}
          <p className="text-sm text-zinc-800 dark:text-zinc-100 break-words">
            {toast.message}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {toast.details && (
            <button
              onClick={toggleDetails}
              className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded"
              title={isExpanded ? 'Hide details' : 'Show details'}
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {toast.details && isExpanded && (
        <div className="text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-200/50 dark:bg-zinc-900/50 rounded-xl p-3 font-mono whitespace-pre-wrap break-all">
          {toast.details}
        </div>
      )}
      {toast.action && (
        <div className="flex justify-end">
          <button
            onClick={handleAction}
            className="text-xs font-medium px-4 py-2 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
          >
            {toast.action.label}
          </button>
        </div>
      )}
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
