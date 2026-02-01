import { useState, useEffect } from 'react';
import { X, Copy, Check } from 'lucide-react';

interface FileViewerModalProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

export function FileViewerModal({ filePath, fileName, onClose }: FileViewerModalProps) {
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchContent = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to load file');
        }
        const data = await res.json();
        setContent(data.content);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchContent();
  }, [filePath]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-800 rounded-lg w-full max-w-4xl max-h-[80vh] mx-4 shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold truncate" title={filePath}>{fileName}</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{filePath}</p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={handleCopy}
              disabled={isLoading || !!error}
              className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
              title="Copy content"
            >
              {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full min-h-[200px] text-zinc-500">
              Loading...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full min-h-[200px] text-red-500 p-4">
              {error}
            </div>
          ) : (
            <pre className="p-4 text-sm font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre overflow-x-auto">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
