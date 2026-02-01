import { useMemo } from 'react';
import { html, parse } from 'diff2html';
import type { DiffResult } from '../../api/projects';

interface DiffViewerProps {
  diffResult: DiffResult | null;
  loading?: boolean;
  error?: string | null;
}

export function DiffViewer({ diffResult, loading, error }: DiffViewerProps) {
  const htmlContent = useMemo(() => {
    if (!diffResult?.diff) return '';

    try {
      const parsed = parse(diffResult.diff);
      return html(parsed, {
        outputFormat: 'side-by-side',
        drawFileList: true,
        matching: 'lines',
      });
    } catch (err) {
      console.error('Error parsing diff:', err);
      return '';
    }
  }, [diffResult?.diff]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-zinc-300 dark:border-zinc-600 border-t-pink-500 rounded-full animate-spin" />
          <span>Loading diff...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="px-4 py-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-200 text-sm">
          {error}
        </div>
      </div>
    );
  }

  if (!diffResult?.diff) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
        <div className="text-center">
          <p className="text-lg mb-2">No changes</p>
          <p className="text-sm">There are no differences to display</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="diff-viewer-content h-full overflow-auto"
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}
