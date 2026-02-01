import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, FolderTree, RefreshCw } from 'lucide-react';
import { FileViewerModal } from './FileViewerModal';

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
}

interface TreeNodeProps {
  entry: FileTreeEntry;
  depth: number;
  onFileClick: (path: string, name: string) => void;
}

function TreeNode({ entry, depth, onFileClick }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleClick = () => {
    if (entry.type === 'directory') {
      setIsExpanded(!isExpanded);
    } else {
      onFileClick(entry.path, entry.name);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className="w-full flex items-center gap-1 py-0.5 px-2 text-left text-xs hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300"
        style={{ paddingLeft: `${depth * 10 + 8}px` }}
      >
        {entry.type === 'directory' ? (
          <>
            {isExpanded ? (
              <ChevronDown size={12} className="text-zinc-400 flex-shrink-0" />
            ) : (
              <ChevronRight size={12} className="text-zinc-400 flex-shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpen size={12} className="text-yellow-600 dark:text-yellow-500 flex-shrink-0" />
            ) : (
              <Folder size={12} className="text-yellow-600 dark:text-yellow-500 flex-shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3" />
            <File size={12} className="text-zinc-400 flex-shrink-0" />
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
              onFileClick={onFileClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileViewerProps {
  worktreePath: string | undefined;
}

export function FileViewer({ worktreePath }: FileViewerProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string } | null>(null);

  const fetchTree = async () => {
    if (!worktreePath) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/files/tree?path=${encodeURIComponent(worktreePath)}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to load');
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
    if (!isCollapsed && worktreePath) {
      fetchTree();
    }
  }, [isCollapsed, worktreePath]);

  const handleFileClick = (path: string, name: string) => {
    setSelectedFile({ path, name });
  };

  if (!worktreePath) return null;

  return (
    <>
      <div className="border-t border-zinc-300 dark:border-zinc-700">
        {/* Header */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-full px-4 py-2 flex items-center justify-between text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50"
        >
          <div className="flex items-center gap-2">
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            <FolderTree size={14} />
            <span className="text-xs font-semibold">FILES</span>
          </div>
          {!isCollapsed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                fetchTree();
              }}
              className="p-0.5 hover:bg-zinc-300 dark:hover:bg-zinc-600 rounded"
              title="Refresh"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
            </button>
          )}
        </button>

        {/* Content */}
        {!isCollapsed && (
          <div className="max-h-48 overflow-y-auto">
            {isLoading && entries.length === 0 ? (
              <div className="px-4 py-2 text-xs text-zinc-500">Loading...</div>
            ) : error ? (
              <div className="px-4 py-2 text-xs text-red-500">{error}</div>
            ) : entries.length === 0 ? (
              <div className="px-4 py-2 text-xs text-zinc-500">No files</div>
            ) : (
              entries.map((entry) => (
                <TreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  onFileClick={handleFileClick}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* File content modal */}
      {selectedFile && (
        <FileViewerModal
          filePath={selectedFile.path}
          fileName={selectedFile.name}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </>
  );
}
