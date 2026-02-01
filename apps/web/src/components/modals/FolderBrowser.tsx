import { useState, useEffect } from 'react';
import { Folder, FolderGit, ChevronRight, Home, ArrowUp } from 'lucide-react';

interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  isGitRepo?: boolean;
}

interface QuickPath {
  name: string;
  path: string;
}

interface FolderBrowserProps {
  onSelect: (path: string) => void;
  onCancel: () => void;
  initialPath?: string;
  selectGitReposOnly?: boolean;
}

export function FolderBrowser({ onSelect, onCancel, initialPath, selectGitReposOnly = true }: FolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '~');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [quickPaths, setQuickPaths] = useState<QuickPath[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    // Load quick paths
    fetch('/api/files/quick-paths')
      .then(res => res.json())
      .then(setQuickPaths)
      .catch(console.error);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    fetch(`/api/files/browse?path=${encodeURIComponent(currentPath)}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load directory');
        return res.json();
      })
      .then(data => {
        setCurrentPath(data.currentPath);
        setEntries(data.entries);
        setSelectedPath(null);
      })
      .catch(err => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [currentPath]);

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
  };

  const handleSelectEntry = (entry: DirectoryEntry) => {
    if (entry.name === '..') {
      handleNavigate(entry.path);
    } else if (entry.isGitRepo) {
      setSelectedPath(entry.path);
    } else if (entry.type === 'directory') {
      if (!selectGitReposOnly) {
        setSelectedPath(entry.path);
      }
      // Double-click to navigate into
    }
  };

  const handleDoubleClick = (entry: DirectoryEntry) => {
    if (entry.type === 'directory') {
      handleNavigate(entry.path);
    }
  };

  const pathParts = currentPath.split('/').filter(Boolean);

  return (
    <div className="flex flex-col h-96 bg-zinc-900 rounded border border-zinc-700">
      {/* Quick paths */}
      <div className="flex items-center gap-1 px-2 py-1 bg-zinc-800 border-b border-zinc-700 overflow-x-auto">
        {quickPaths.map(qp => (
          <button
            key={qp.path}
            onClick={() => handleNavigate(qp.path)}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded whitespace-nowrap"
          >
            {qp.name === 'Home' ? <Home size={12} /> : <Folder size={12} />}
            {qp.name}
          </button>
        ))}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-3 py-2 bg-zinc-800/50 border-b border-zinc-700 text-sm overflow-x-auto">
        <button
          onClick={() => handleNavigate('/')}
          className="text-zinc-400 hover:text-white"
        >
          /
        </button>
        {pathParts.map((part, i) => (
          <span key={i} className="flex items-center">
            <ChevronRight size={14} className="text-zinc-600" />
            <button
              onClick={() => handleNavigate('/' + pathParts.slice(0, i + 1).join('/'))}
              className="text-zinc-400 hover:text-white px-1"
            >
              {part}
            </button>
          </span>
        ))}
      </div>

      {/* Directory listing */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            Loading...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-400">
            {error}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            Empty directory
          </div>
        ) : (
          <div className="space-y-0.5">
            {entries.map(entry => (
              <button
                key={entry.path}
                onClick={() => handleSelectEntry(entry)}
                onDoubleClick={() => handleDoubleClick(entry)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded text-left text-sm ${
                  selectedPath === entry.path
                    ? 'bg-red-600 text-white'
                    : entry.isGitRepo
                    ? 'bg-zinc-800 hover:bg-zinc-700 text-green-400'
                    : 'hover:bg-zinc-800 text-zinc-300'
                }`}
              >
                {entry.name === '..' ? (
                  <ArrowUp size={16} className="text-zinc-400" />
                ) : entry.isGitRepo ? (
                  <FolderGit size={16} />
                ) : (
                  <Folder size={16} className="text-zinc-400" />
                )}
                <span className="flex-1 truncate">{entry.name}</span>
                {entry.isGitRepo && (
                  <span className="text-xs text-green-500 bg-green-900/30 px-1.5 py-0.5 rounded">
                    git
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected path display */}
      {selectedPath && (
        <div className="px-3 py-2 bg-zinc-800/50 border-t border-zinc-700 text-sm">
          <span className="text-zinc-400">Selected: </span>
          <span className="text-green-400">{selectedPath}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 px-3 py-2 bg-zinc-800 border-t border-zinc-700">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-sm"
        >
          Cancel
        </button>
        <button
          onClick={() => selectedPath && onSelect(selectedPath)}
          disabled={!selectedPath}
          className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-sm disabled:opacity-50"
        >
          Select
        </button>
      </div>
    </div>
  );
}
