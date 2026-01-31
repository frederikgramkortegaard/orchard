import { create } from 'zustand';

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
}

interface EditorState {
  openFiles: OpenFile[];
  activeFilePath: string | null;

  // Actions
  openFile: (path: string, name: string, content: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  updateFileContent: (path: string, content: string) => void;
  closeAllFiles: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  openFiles: [],
  activeFilePath: null,

  openFile: (path, name, content) =>
    set((state) => {
      // Check if file is already open
      const existing = state.openFiles.find((f) => f.path === path);
      if (existing) {
        return { activeFilePath: path };
      }
      return {
        openFiles: [...state.openFiles, { path, name, content, isDirty: false }],
        activeFilePath: path,
      };
    }),

  closeFile: (path) =>
    set((state) => {
      const newFiles = state.openFiles.filter((f) => f.path !== path);
      let newActive = state.activeFilePath;

      // If closing active file, switch to another open file
      if (state.activeFilePath === path) {
        const idx = state.openFiles.findIndex((f) => f.path === path);
        if (newFiles.length > 0) {
          // Try to activate next file, or previous if at end
          newActive = newFiles[Math.min(idx, newFiles.length - 1)]?.path || null;
        } else {
          newActive = null;
        }
      }

      return { openFiles: newFiles, activeFilePath: newActive };
    }),

  setActiveFile: (path) => set({ activeFilePath: path }),

  updateFileContent: (path, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, content, isDirty: true } : f
      ),
    })),

  closeAllFiles: () => set({ openFiles: [], activeFilePath: null }),
}));
