import { useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useEditorStore } from '../../stores/editor.store';
import { useToast } from '../../contexts/ToastContext';
import { FileTree } from './FileTree';
import { FileTabs } from './FileTabs';

interface EditorPaneProps {
  worktreePath: string | undefined;
}

// Map file extensions to Monaco language identifiers
function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    toml: 'toml',
    ini: 'ini',
    env: 'plaintext',
    gitignore: 'plaintext',
  };
  return langMap[ext] || 'plaintext';
}

export function EditorPane({ worktreePath }: EditorPaneProps) {
  const { openFiles, activeFilePath, openFile, closeFile, setActiveFile, updateFileContent } =
    useEditorStore();
  const { addToast } = useToast();

  const activeFile = openFiles.find((f) => f.path === activeFilePath);

  const handleFileSelect = useCallback(
    async (path: string, name: string) => {
      // Check if already open
      const existing = openFiles.find((f) => f.path === path);
      if (existing) {
        setActiveFile(path);
        return;
      }

      // Fetch file content
      try {
        const res = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`);
        if (!res.ok) {
          const err = await res.json();
          addToast('error', err.error || `Failed to load "${name}"`);
          return;
        }
        const data = await res.json();
        openFile(path, name, data.content);
      } catch (err) {
        addToast('error', `Failed to load "${name}"`);
      }
    },
    [openFiles, openFile, setActiveFile, addToast]
  );

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (activeFilePath && value !== undefined) {
        updateFileContent(activeFilePath, value);
      }
    },
    [activeFilePath, updateFileContent]
  );

  return (
    <Group orientation="horizontal" className="h-full">
      {/* File Tree */}
      <Panel defaultSize={20} minSize={5}>
        <FileTree rootPath={worktreePath} onFileSelect={handleFileSelect} />
      </Panel>

      <Separator className="w-1 bg-zinc-700 hover:bg-zinc-600 cursor-col-resize" />

      {/* Editor Area */}
      <Panel minSize={5}>
        <div className="h-full flex flex-col bg-zinc-900">
          {/* Tabs */}
          <FileTabs
            files={openFiles}
            activeFilePath={activeFilePath}
            onTabClick={setActiveFile}
            onTabClose={closeFile}
          />

          {/* Monaco Editor */}
          <div className="flex-1 overflow-hidden">
            {activeFile ? (
              <Editor
                height="100%"
                language={getLanguageFromPath(activeFile.path)}
                value={activeFile.content}
                onChange={handleEditorChange}
                theme="vs-dark"
                options={{
                  minimap: { enabled: true },
                  fontSize: 13,
                  fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, monospace",
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  wordWrap: 'off',
                  renderWhitespace: 'selection',
                  padding: { top: 8 },
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-500">
                {worktreePath ? (
                  <div className="text-center">
                    <p>Select a file to open</p>
                    <p className="text-sm text-zinc-600 mt-1">
                      Browse files in the tree on the left
                    </p>
                  </div>
                ) : (
                  <p>Select a worktree to start editing</p>
                )}
              </div>
            )}
          </div>
        </div>
      </Panel>
    </Group>
  );
}
