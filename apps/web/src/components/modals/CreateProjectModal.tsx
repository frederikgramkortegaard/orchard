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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-backdrop">
      <div className="bg-white dark:bg-neutral-800 rounded-xl w-full max-w-md mx-4 shadow-2xl animate-modal border border-zinc-200 dark:border-neutral-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-neutral-700">
          <h2 className="text-base font-semibold">Open Project</h2>
          <button onClick={onClose} className="p-1 text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-neutral-700 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Mode selector */}
          <div className="flex gap-1 p-1 bg-zinc-100 dark:bg-neutral-900 rounded-lg">
            <button
              type="button"
              onClick={() => setMode('recent')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                mode === 'recent'
                  ? 'bg-white dark:bg-neutral-700 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              <Clock size={14} />
              Recent
            </button>
            <button
              type="button"
              onClick={() => setMode('url')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                mode === 'url'
                  ? 'bg-white dark:bg-neutral-700 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              <GitBranch size={14} />
              Clone
            </button>
            <button
              type="button"
              onClick={() => setMode('local')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                mode === 'local'
                  ? 'bg-white dark:bg-neutral-700 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              <Folder size={14} />
              Local
            </button>
          </div>

          {mode === 'recent' ? (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {availableProjects.length === 0 ? (
                <p className="text-zinc-400 dark:text-zinc-500 text-center py-6 text-sm">No recent projects</p>
              ) : (
                availableProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => handleOpenExisting(project)}
                    disabled={isSubmitting}
                    className="w-full flex items-center gap-3 px-3 py-2.5 bg-zinc-50 dark:bg-neutral-900 hover:bg-zinc-100 dark:hover:bg-neutral-700 rounded-lg text-left transition-colors group"
                  >
                    <div className="p-1.5 bg-blue-500/10 dark:bg-blue-500/20 rounded-md">
                      <Folder size={16} className="text-blue-500 dark:text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{project.name}</div>
                      <div className="text-xs text-zinc-400 dark:text-zinc-500 truncate font-mono">{project.path}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : mode === 'url' ? (
            <div>
              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Repository URL</label>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="input"
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
              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Local Repository Path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder="/path/to/existing/repo"
                  className="input flex-1"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowBrowser(true)}
                  className="px-3 py-2 bg-zinc-100 dark:bg-neutral-700 hover:bg-zinc-200 dark:hover:bg-neutral-600 rounded-lg transition-colors"
                  title="Browse folders"
                >
                  <FolderOpen size={16} />
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Project Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-detected from repo"
              className="input"
            />
          </div>

          {error && (
            <div className="px-3 py-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg text-red-600 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-zinc-100 dark:bg-neutral-700 hover:bg-zinc-200 dark:hover:bg-neutral-600 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 shadow-sm hover:shadow-md transition-all"
            >
              {isSubmitting ? 'Creating...' : 'Open Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
