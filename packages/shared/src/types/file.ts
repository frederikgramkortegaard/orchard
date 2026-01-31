export interface FileTreeNode {
  name: string;
  path: string;           // Relative to worktree root
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  size?: number;
  modified?: string;
}

export interface FileContent {
  path: string;
  content: string;
  encoding?: string;
}

export type FileEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface FileEvent {
  type: FileEventType;
  path: string;
  worktreeId: string;
}
