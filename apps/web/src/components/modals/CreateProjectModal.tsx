import { useState, useEffect } from 'react';
import { X, GitBranch, Folder, FolderOpen, Clock } from 'lucide-react';
import { FolderBrowser } from './FolderBrowser';
import * as api from '../../api/projects';
import type { Project } from '../../stores/project.store';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { repoUrl?: string; localPath?: string; name?: string; inPlace?: boolean }) => Promise<void>;
  onOpenExisting?: (project: Project) => void;
}

export function CreateProjectModal({ isOpen, onClose, onSubmit, onOpenExisting }: CreateProjectModalProps) {
  const [mode, setMode] = useState<'recent' | 'url' | 'local'>('recent');
  const [repoUrl, setRepoUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);


  // Load available projects when modal opens
  useEffect(() => {
    if (isOpen) {
      api.fetchAvailableProjects().then(setAvailableProjects).catch(console.error);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOpenExisting = async (project: Project) => {
    setIsSubmitting(true);
    try {
      const openedProject = await api.openProject(project.id);
      onOpenExisting?.(openedProject);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onSubmit({
        repoUrl: mode === 'url' ? repoUrl : undefined,
        localPath: mode === 'local' ? localPath : undefined,
        name: name || undefined,
      });
      onClose();
      setRepoUrl('');
      setLocalPath('');
      setName('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-zinc-800 rounded-lg w-full max-w-md mx-4 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-lg font-semibold">Open Project</h2>
          <button onClick={onClose} className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Mode selector */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('recent')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded ${
                mode === 'recent' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-white' : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <Clock size={16} />
              Recent
            </button>
            <button
              type="button"
              onClick={() => setMode('url')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded ${
                mode === 'url' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-white' : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <GitBranch size={16} />
              Clone
            </button>
            <button
              type="button"
              onClick={() => setMode('local')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded ${
                mode === 'local' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-white' : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <Folder size={16} />
              Local
            </button>
          </div>

          {mode === 'recent' ? (
            <div className="space-y-2">
              {availableProjects.length === 0 ? (
                <p className="text-zinc-500 text-center py-4">No recent projects</p>
              ) : (
                availableProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => handleOpenExisting(project)}
                    disabled={isSubmitting}
                    className="w-full flex items-center gap-3 px-3 py-2 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-left"
                  >
                    <Folder size={18} className="text-zinc-500 dark:text-zinc-400" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{project.name}</div>
                      <div className="text-xs text-zinc-500 truncate">{project.path}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : mode === 'url' ? (
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1">Repository URL</label>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded focus:outline-none focus:border-blue-500"
                required
              />
            </div>
          ) : showBrowser ? (
            <FolderBrowser
              onSelect={(path) => {
                setLocalPath(path);
                setShowBrowser(false);
              }}
              onCancel={() => setShowBrowser(false)}
              initialPath={localPath || '~'}
              selectGitReposOnly={true}
            />
          ) : (
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1">Local Repository Path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder="/path/to/existing/repo"
                  className="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded focus:outline-none focus:border-blue-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowBrowser(true)}
                  className="px-3 py-2 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 rounded"
                  title="Browse folders"
                >
                  <FolderOpen size={18} />
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1">Project Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-detected from repo"
              className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded focus:outline-none focus:border-blue-500"
            />
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-100 dark:bg-red-900/50 border border-red-300 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Open Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
