import { X, CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';
import { useToast, type Toast as ToastType, type ToastType as ToastVariant } from '../contexts/ToastContext';

const iconMap: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle size={16} className="text-emerald-500" />,
  error: <XCircle size={16} className="text-red-500" />,
  warning: <AlertTriangle size={16} className="text-amber-500" />,
  info: <Info size={16} className="text-blue-500" />,
};

const bgColorMap: Record<ToastVariant, string> = {
  success: 'bg-white dark:bg-neutral-800 border-emerald-200 dark:border-emerald-800/50',
  error: 'bg-white dark:bg-neutral-800 border-red-200 dark:border-red-800/50',
  warning: 'bg-white dark:bg-neutral-800 border-amber-200 dark:border-amber-800/50',
  info: 'bg-white dark:bg-neutral-800 border-blue-200 dark:border-blue-800/50',
};

const iconBgMap: Record<ToastVariant, string> = {
  success: 'bg-emerald-50 dark:bg-emerald-900/30',
  error: 'bg-red-50 dark:bg-red-900/30',
  warning: 'bg-amber-50 dark:bg-amber-900/30',
  info: 'bg-blue-50 dark:bg-blue-900/30',
};

function ToastItem({ toast }: { toast: ToastType }) {
  const { removeToast } = useToast();

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg ${bgColorMap[toast.type]} animate-slide-in`}
    >
      <div className={`p-1.5 rounded-lg ${iconBgMap[toast.type]}`}>
        {iconMap[toast.type]}
      </div>
      <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-200">
        {toast.message}
      </span>
      <button
        onClick={() => removeToast(toast.id)}
        className="p-1 text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-neutral-700 transition-colors"
      >
        <X size={14} />
      </button>
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
