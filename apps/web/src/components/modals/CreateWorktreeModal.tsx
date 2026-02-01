import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { fetchBranches } from '../../api/projects';

interface CreateWorktreeModalProps {
  isOpen: boolean;
  projectId: string;
  onClose: () => void;
  onSubmit: (data: { branch: string; newBranch?: boolean; baseBranch?: string }) => Promise<void>;
}

export function CreateWorktreeModal({ isOpen, projectId, onClose, onSubmit }: CreateWorktreeModalProps) {
  const [mode, setMode] = useState<'existing' | 'new'>('new');
  const [branch, setBranch] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [branches, setBranches] = useState<{ local: string[]; remote: string[]; defaultBranch: string }>({ local: [], remote: [], defaultBranch: 'main' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && projectId) {
      fetchBranches(projectId)
        .then((data) => {
          setBranches(data);
          // Set default base branch to the repo's default
          if (!baseBranch) {
            setBaseBranch(data.defaultBranch);
          }
        })
        .catch(console.error);
    }
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onSubmit({
        branch,
        newBranch: mode === 'new',
        baseBranch: mode === 'new' ? baseBranch : undefined,
      });
      onClose();
      setBranch('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const allBranches = [...new Set([...branches.local, ...branches.remote])];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-zinc-800 rounded-lg w-full max-w-md mx-4 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-lg font-semibold">Create Worktree</h2>
          <button onClick={onClose} className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Mode selector */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`flex-1 px-3 py-2 rounded ${
                mode === 'new' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-white' : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              New Branch
            </button>
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={`flex-1 px-3 py-2 rounded ${
                mode === 'existing' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-white' : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              Existing Branch
            </button>
          </div>

          {mode === 'new' ? (
            <>
              <div>
                <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1">New Branch Name</label>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="feature/my-feature"
                  className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded focus:outline-none focus:border-green-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1">Base Branch</label>
                <select
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded focus:outline-none focus:border-green-500"
                >
                  {allBranches.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1">Select Branch</label>
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded focus:outline-none focus:border-green-500"
                required
              >
                <option value="">Select a branch...</option>
                {allBranches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          )}

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
              disabled={isSubmitting || !branch}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Worktree'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
