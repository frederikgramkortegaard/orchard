import { X, CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';
import { useToast, type Toast as ToastType, type ToastType as ToastVariant } from '../contexts/ToastContext';

const iconMap: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle size={18} className="text-green-500" />,
  error: <XCircle size={18} className="text-red-500" />,
  warning: <AlertTriangle size={18} className="text-amber-500" />,
  info: <Info size={18} className="text-blue-500" />,
};

const bgColorMap: Record<ToastVariant, string> = {
  success: 'bg-green-50 dark:bg-green-900/30 pink:bg-green-50 border-green-200 dark:border-green-800 pink:border-green-200',
  error: 'bg-red-50 dark:bg-red-900/30 pink:bg-red-50 border-red-200 dark:border-red-800 pink:border-red-200',
  warning: 'bg-amber-50 dark:bg-amber-900/30 pink:bg-amber-50 border-amber-200 dark:border-amber-800 pink:border-amber-200',
  info: 'bg-blue-50 dark:bg-blue-900/30 pink:bg-blue-50 border-blue-200 dark:border-blue-800 pink:border-blue-200',
};

function ToastItem({ toast }: { toast: ToastType }) {
  const { removeToast } = useToast();

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg ${bgColorMap[toast.type]} animate-slide-in`}
    >
      {iconMap[toast.type]}
      <span className="flex-1 text-sm text-zinc-800 dark:text-zinc-100 pink:text-pink-900">
        {toast.message}
      </span>
      <button
        onClick={() => removeToast(toast.id)}
        className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 pink:hover:text-pink-600 rounded"
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
