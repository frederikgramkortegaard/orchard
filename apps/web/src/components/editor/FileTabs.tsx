import { X, Circle } from 'lucide-react';
import { useEditorStore, type OpenFile } from '../../stores/editor.store';

interface FileTabsProps {
  files: OpenFile[];
  activeFilePath: string | null;
  onTabClick: (path: string) => void;
  onTabClose: (path: string) => void;
}

export function FileTabs({ files, activeFilePath, onTabClick, onTabClose }: FileTabsProps) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center bg-zinc-800 border-b border-zinc-700 overflow-x-auto">
      {files.map((file) => {
        const isActive = file.path === activeFilePath;
        return (
          <div
            key={file.path}
            className={`group flex items-center gap-2 px-3 py-2 border-r border-zinc-700 cursor-pointer min-w-0 ${
              isActive
                ? 'bg-zinc-900 text-zinc-100'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700/50'
            }`}
            onClick={() => onTabClick(file.path)}
          >
            <span className="truncate text-sm max-w-[150px]">{file.name}</span>
            {file.isDirty && (
              <Circle size={8} className="fill-current text-zinc-400 flex-shrink-0" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(file.path);
              }}
              className="p-0.5 rounded hover:bg-zinc-600 opacity-0 group-hover:opacity-100 flex-shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
