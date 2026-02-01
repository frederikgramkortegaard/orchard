import { useEffect, useCallback } from 'react';
import { useEditorStore } from '../stores/editor.store';

export function useKeyboardShortcuts() {
  const { openFiles, activeFilePath, closeFile, setActiveFile, markFileSaved } = useEditorStore();

  const saveCurrentFile = useCallback(async () => {
    const activeFile = openFiles.find((f) => f.path === activeFilePath);
    if (!activeFile || !activeFile.isDirty) return;

    try {
      const res = await fetch('/api/files/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: activeFile.path,
          content: activeFile.content,
        }),
      });

      if (res.ok) {
        markFileSaved(activeFile.path);
      } else {
        const err = await res.json();
        console.error('Failed to save file:', err.error);
      }
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }, [openFiles, activeFilePath, markFileSaved]);

  const closeCurrentTab = useCallback(() => {
    if (activeFilePath) {
      closeFile(activeFilePath);
    }
  }, [activeFilePath, closeFile]);

  const switchToTab = useCallback((index: number) => {
    if (index >= 0 && index < openFiles.length) {
      setActiveFile(openFiles[index].path);
    }
  }, [openFiles, setActiveFile]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      if (!isMod) return;

      // Cmd/Ctrl+S - Save current file
      if (e.key === 's') {
        e.preventDefault();
        saveCurrentFile();
        return;
      }

      // Cmd/Ctrl+W - Close current tab
      if (e.key === 'w') {
        e.preventDefault();
        closeCurrentTab();
        return;
      }

      // Cmd/Ctrl+1-9 - Switch to tab by number
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        switchToTab(num - 1); // 1-indexed to 0-indexed
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveCurrentFile, closeCurrentTab, switchToTab]);
}
