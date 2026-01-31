import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, RefreshCw } from 'lucide-react';

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
}

interface FileTreeProps {
  rootPath: string | undefined;
  onFileSelect: (path: string, name: string) => void;
}

interface TreeNodeProps {
  entry: FileTreeEntry;
  depth: number;
  onFileSelect: (path: string, name: string) => void;
  selectedPath: string | null;
}

function TreeNode({ entry, depth, onFileSelect, selectedPath }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const isSelected = selectedPath === entry.path;

  const handleClick = () => {
    if (entry.type === 'directory') {
      setIsExpanded(!isExpanded);
    } else {
      onFileSelect(entry.path, entry.name);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-1 py-0.5 px-2 text-left text-sm hover:bg-zinc-700/50 ${
          isSelected ? 'bg-blue-600/30 text-blue-300' : 'text-zinc-300'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {entry.type === 'directory' ? (
          <>
            {isExpanded ? (
              <ChevronDown size={14} className="text-zinc-500 flex-shrink-0" />
            ) : (
              <ChevronRight size={14} className="text-zinc-500 flex-shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpen size={14} className="text-yellow-500 flex-shrink-0" />
            ) : (
              <Folder size={14} className="text-yellow-500 flex-shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <File size={14} className="text-zinc-400 flex-shrink-0" />
          </>
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {entry.type === 'directory' && isExpanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ rootPath, onFileSelect }: FileTreeProps) {
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const fetchTree = async () => {
    if (!rootPath) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/files/tree?path=${encodeURIComponent(rootPath)}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to load file tree');
      }
      const data = await res.json();
      setEntries(data.entries);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTree();
  }, [rootPath]);

  const handleFileSelect = (path: string, name: string) => {
    setSelectedPath(path);
    onFileSelect(path, name);
  };

  if (!rootPath) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 text-sm p-4">
        Select a worktree to browse files
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Files
        </span>
        <button
          onClick={fetchTree}
          className="p-1 hover:bg-zinc-700 rounded"
          title="Refresh"
        >
          <RefreshCw size={14} className={`text-zinc-400 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            Loading...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-400 text-sm p-4">
            {error}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            No files found
          </div>
        ) : (
          entries.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              onFileSelect={handleFileSelect}
              selectedPath={selectedPath}
            />
          ))
        )}
      </div>
    </div>
  );
}
