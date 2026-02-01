import { useState, useEffect, useCallback } from 'react';
import { X, FileCode, GitBranch, GitCommit, Files } from 'lucide-react';
import { DiffViewer } from './DiffViewer';
import {
  fetchDiff,
  fetchCommits,
  fetchWorktreeBranches,
  type DiffType,
  type DiffResult,
  type Commit,
} from '../../api/projects';

interface DiffViewerModalProps {
  isOpen: boolean;
  worktreeId: string;
  worktreeBranch: string;
  onClose: () => void;
}

const DIFF_TYPES: { type: DiffType; label: string; icon: typeof FileCode; description: string }[] = [
  { type: 'working', label: 'Working', icon: Files, description: 'Unstaged changes' },
  { type: 'staged', label: 'Staged', icon: FileCode, description: 'Staged for commit' },
  { type: 'branch', label: 'Branch', icon: GitBranch, description: 'Compare with branch' },
  { type: 'commit', label: 'Commits', icon: GitCommit, description: 'Compare commits' },
];

export function DiffViewerModal({ isOpen, worktreeId, worktreeBranch, onClose }: DiffViewerModalProps) {
  const [diffType, setDiffType] = useState<DiffType>('working');
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For branch comparison
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('main');

  // For commit comparison
  const [commits, setCommits] = useState<Commit[]>([]);
  const [baseCommit, setBaseCommit] = useState<string>('');
  const [targetCommit, setTargetCommit] = useState<string>('');

  // Load branches and commits when modal opens
  useEffect(() => {
    if (isOpen && worktreeId) {
      fetchWorktreeBranches(worktreeId)
        .then((result) => {
          setBranches(result.branches);
          // Default to 'main' or first branch that's not current
          const defaultBranch = result.branches.find((b) => b === 'main') ||
            result.branches.find((b) => b !== worktreeBranch) ||
            result.branches[0] || 'main';
          setSelectedBranch(defaultBranch);
        })
        .catch(console.error);

      fetchCommits(worktreeId, 50)
        .then((result) => {
          setCommits(result.commits);
          if (result.commits.length >= 2) {
            setBaseCommit(result.commits[1].hash);
            setTargetCommit(result.commits[0].hash);
          } else if (result.commits.length === 1) {
            setBaseCommit(result.commits[0].hash + '~1');
            setTargetCommit(result.commits[0].hash);
          }
        })
        .catch(console.error);
    }
  }, [isOpen, worktreeId, worktreeBranch]);

  // Fetch diff when type or options change
  const loadDiff = useCallback(async () => {
    if (!worktreeId) return;

    setLoading(true);
    setError(null);

    try {
      let result: DiffResult;
      switch (diffType) {
        case 'branch':
          result = await fetchDiff(worktreeId, 'branch', selectedBranch);
          break;
        case 'commit':
          result = await fetchDiff(worktreeId, 'commit', baseCommit, targetCommit);
          break;
        default:
          result = await fetchDiff(worktreeId, diffType);
      }
      setDiffResult(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load diff');
      setDiffResult(null);
    } finally {
      setLoading(false);
    }
  }, [worktreeId, diffType, selectedBranch, baseCommit, targetCommit]);

  useEffect(() => {
    if (isOpen) {
      loadDiff();
    }
  }, [isOpen, loadDiff]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setDiffResult(null);
      setError(null);
      setDiffType('working');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-zinc-800 rounded-lg w-full max-w-6xl h-[85vh] mx-4 shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Diff Viewer</h2>
            <span className="text-sm text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-700 px-2 py-0.5 rounded">
              {worktreeBranch}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700"
          >
            <X size={20} />
          </button>
        </div>

        {/* Diff type tabs */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
          {DIFF_TYPES.map(({ type, label, icon: Icon, description }) => (
            <button
              key={type}
              onClick={() => setDiffType(type)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${
                diffType === type
                  ? 'bg-pink-100 dark:bg-pink-900/50 text-pink-700 dark:text-pink-300'
                  : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'
              }`}
              title={description}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}

          {/* Options for branch/commit comparison */}
          {diffType === 'branch' && (
            <div className="flex items-center gap-2 ml-4 pl-4 border-l border-zinc-200 dark:border-zinc-700">
              <span className="text-sm text-zinc-500 dark:text-zinc-400">Compare with:</span>
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="px-2 py-1 text-sm bg-zinc-100 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded focus:outline-none focus:border-pink-500"
              >
                {branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </div>
          )}

          {diffType === 'commit' && (
            <div className="flex items-center gap-2 ml-4 pl-4 border-l border-zinc-200 dark:border-zinc-700">
              <span className="text-sm text-zinc-500 dark:text-zinc-400">From:</span>
              <select
                value={baseCommit}
                onChange={(e) => setBaseCommit(e.target.value)}
                className="px-2 py-1 text-sm bg-zinc-100 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded focus:outline-none focus:border-pink-500 max-w-[200px]"
              >
                {commits.map((commit) => (
                  <option key={commit.hash} value={commit.hash}>
                    {commit.hashShort} - {commit.message.slice(0, 30)}
                  </option>
                ))}
              </select>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">To:</span>
              <select
                value={targetCommit}
                onChange={(e) => setTargetCommit(e.target.value)}
                className="px-2 py-1 text-sm bg-zinc-100 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded focus:outline-none focus:border-pink-500 max-w-[200px]"
              >
                {commits.map((commit) => (
                  <option key={commit.hash} value={commit.hash}>
                    {commit.hashShort} - {commit.message.slice(0, 30)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Diff content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <DiffViewer diffResult={diffResult} loading={loading} error={error} />
        </div>
      </div>
    </div>
  );
}
