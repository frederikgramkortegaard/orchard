import { useState } from 'react';
import { X, CheckCircle, XCircle, AlertTriangle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast, type Toast as ToastType, type ToastType as ToastVariant } from '../contexts/ToastContext';

const iconMap: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle size={18} className="text-green-500" />,
  error: <XCircle size={18} className="text-red-500" />,
  warning: <AlertTriangle size={18} className="text-amber-500" />,
  info: <Info size={18} className="text-red-500" />,
};

const bgColorMap: Record<ToastVariant, string> = {
  success: 'bg-green-50 dark:bg-green-900/30 pink:bg-green-50 border-green-200 dark:border-green-800 pink:border-green-200',
  error: 'bg-red-50 dark:bg-red-900/30 pink:bg-red-50 border-red-200 dark:border-red-800 pink:border-red-200',
  warning: 'bg-amber-50 dark:bg-amber-900/30 pink:bg-amber-50 border-amber-200 dark:border-amber-800 pink:border-amber-200',
  info: 'bg-red-50 dark:bg-red-900/30 pink:bg-red-50 border-red-200 dark:border-red-800 pink:border-red-200',
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
      className={`flex flex-col gap-2 px-4 py-3 rounded-lg border shadow-lg cursor-pointer ${bgColorMap[toast.type]} animate-slide-in`}
    >
      <div className="flex items-center gap-3">
        {iconMap[toast.type]}
        <div className="flex-1 min-w-0">
          {toast.operation && (
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 pink:text-pink-600">
              {toast.operation}
            </span>
          )}
          <p className="text-sm text-zinc-800 dark:text-zinc-100 pink:text-pink-900 break-words">
            {toast.message}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {toast.details && (
            <button
              onClick={toggleDetails}
              className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 pink:hover:text-pink-600 rounded"
              title={isExpanded ? 'Hide details' : 'Show details'}
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 pink:hover:text-pink-600 rounded"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {toast.details && isExpanded && (
        <div className="text-xs text-zinc-600 dark:text-zinc-300 pink:text-pink-700 bg-black/5 dark:bg-black/20 pink:bg-pink-200/50 rounded p-2 font-mono whitespace-pre-wrap break-all">
          {toast.details}
        </div>
      )}
      {toast.action && (
        <div className="flex justify-end">
          <button
            onClick={handleAction}
            className="text-xs font-medium px-3 py-1.5 rounded bg-zinc-200 dark:bg-zinc-700 pink:bg-pink-200 text-zinc-700 dark:text-zinc-200 pink:text-pink-800 hover:bg-zinc-300 dark:hover:bg-zinc-600 pink:hover:bg-pink-300 transition-colors"
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
