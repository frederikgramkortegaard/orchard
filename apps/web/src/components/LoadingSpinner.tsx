import { Loader2 } from 'lucide-react';

type SpinnerSize = 'sm' | 'md' | 'lg';
type SpinnerVariant = 'inline' | 'centered' | 'overlay';

interface LoadingSpinnerProps {
  /** Size of the spinner: 'sm' (14px), 'md' (24px), 'lg' (32px) */
  size?: SpinnerSize;
  /** Variant: 'inline' for inline text, 'centered' for centered in container, 'overlay' for full-screen overlay */
  variant?: SpinnerVariant;
  /** Optional label to display alongside the spinner */
  label?: string;
  /** Additional CSS classes */
  className?: string;
}

const sizeMap: Record<SpinnerSize, number> = {
  sm: 14,
  md: 24,
  lg: 32,
};

const textSizeMap: Record<SpinnerSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

export function LoadingSpinner({
  size = 'md',
  variant = 'inline',
  label,
  className = '',
}: LoadingSpinnerProps) {
  const spinnerElement = (
    <Loader2
      size={sizeMap[size]}
      className="animate-spin text-green-600 dark:text-green-500"
    />
  );

  if (variant === 'inline') {
    return (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        {spinnerElement}
        {label && (
          <span className={`text-zinc-500 dark:text-zinc-400 ${textSizeMap[size]}`}>
            {label}
          </span>
        )}
      </span>
    );
  }

  if (variant === 'centered') {
    return (
      <div className={`flex items-center justify-center h-full text-zinc-500 dark:text-zinc-400 ${className}`}>
        <div className="flex flex-col items-center gap-2">
          {spinnerElement}
          {label && (
            <span className={textSizeMap[size]}>{label}</span>
          )}
        </div>
      </div>
    );
  }

  // variant === 'overlay'
  return (
    <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 ${className}`}>
      <div className="bg-white dark:bg-zinc-800 rounded-lg p-6 flex flex-col items-center gap-3 shadow-xl">
        {spinnerElement}
        {label && (
          <span className={`text-zinc-700 dark:text-zinc-300 ${textSizeMap[size]}`}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
