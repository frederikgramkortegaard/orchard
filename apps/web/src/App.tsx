import { useState, useEffect, useCallback } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Sun, Moon, Settings, Activity, GitCommit } from 'lucide-react';
import { useProjectStore } from './stores/project.store';
import { useTheme } from './contexts/ThemeContext';
import { useToast } from './contexts/ToastContext';
import { ProjectTabBar } from './components/layout/ProjectTabBar';
import { Sidebar } from './components/sidebar/Sidebar';
import { CreateProjectModal } from './components/modals/CreateProjectModal';
import { CreateWorktreeModal } from './components/modals/CreateWorktreeModal';
import { KeyboardShortcutsModal } from './components/modals/KeyboardShortcutsModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { DiffViewerModal } from './components/diff';
import { OrchestratorPanel } from './components/orchestrator/OrchestratorPanel';
import { ActivityLog } from './components/orchestrator/ActivityLog';
import { Dashboard } from './components/dashboard/Dashboard';
import { GitHistorySidebar, CommitDetailModal } from './components/git-history';
import * as api from './api/projects';

type RightPanelTab = 'activity' | 'git-history';

function App() {
  const { theme, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showWorktreeModal, setShowWorktreeModal] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [diffViewerState, setDiffViewerState] = useState<{ worktreeId: string; branch: string } | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('activity');
  const [commitDetailState, setCommitDetailState] = useState<{
    commitHash: string | null;
    compareBase: string | null;
    compareTarget: string | null;
  } | null>(null);
  const {
    projects,
    activeProjectId,
    worktrees,
    activeWorktreeId,
    setProjects,
    setWorktrees,
    addProject,
    addWorktree,
    removeWorktree,
    updateWorktree,
    removeProject,
  } = useProjectStore();

  // Load projects on mount
  useEffect(() => {
    api.fetchProjects().then(setProjects).catch(console.error);
  }, [setProjects]);

  // Load worktrees when project changes and poll for updates (includes conflict info)
  useEffect(() => {
    if (activeProjectId) {
      const fetchAndUpdate = () => {
        api.fetchWorktreesWithConflicts(activeProjectId).then(setWorktrees).catch(console.error);
      };
      fetchAndUpdate();
      const interval = setInterval(fetchAndUpdate, 5000);
      return () => clearInterval(interval);
    } else {
      setWorktrees([]);
    }
  }, [activeProjectId, setWorktrees]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // ? - Show keyboard shortcuts
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowShortcutsModal(true);
      }

      // Cmd/Ctrl + , - Open settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setShowSettingsModal(true);
      }

      // Escape - Close modals
      if (e.key === 'Escape') {
        setShowShortcutsModal(false);
        setShowProjectModal(false);
        setShowWorktreeModal(false);
        setShowSettingsModal(false);
        setDiffViewerState(null);
        setCommitDetailState(null);
      }

      // Cmd/Ctrl + 1-9 - Switch to worktree
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;
        const sortedWorktrees = worktrees.filter(w => !w.archived);
        if (index < sortedWorktrees.length) {
          e.preventDefault();
          useProjectStore.getState().setActiveWorktree(sortedWorktrees[index].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [worktrees]);

  const handleCreateProject = useCallback(async (data: { repoUrl?: string; localPath?: string; name?: string; inPlace?: boolean }) => {
    const project = await api.createProject(data);
    addProject(project);
  }, [addProject]);

  const handleOpenExisting = useCallback((project: typeof projects[0]) => {
    addProject(project);
  }, [addProject]);

  const handleCreateWorktree = useCallback(async (data: { branch: string; newBranch?: boolean; baseBranch?: string }) => {
    if (!activeProjectId) return;
    try {
      const worktree = await api.createWorktree({ projectId: activeProjectId, ...data });
      addWorktree(worktree);
      addToast('success', `Worktree "${data.branch}" created`);
    } catch (err: any) {
      addToast('error', err.message || 'Failed to create worktree');
      throw err;
    }
  }, [activeProjectId, addWorktree, addToast]);

  const handleDeleteWorktree = useCallback(async (worktreeId: string) => {
    const worktree = worktrees.find(w => w.id === worktreeId);
    try {
      await api.deleteWorktree(worktreeId);
      removeWorktree(worktreeId);
      addToast('success', `Worktree "${worktree?.branch || 'unknown'}" deleted`);
    } catch (err: any) {
      addToast('error', err.message || 'Failed to delete worktree');
    }
  }, [worktrees, removeWorktree, addToast]);

  const handleArchiveWorktree = useCallback(async (worktreeId: string) => {
    const worktree = worktrees.find(w => w.id === worktreeId);
    try {
      await api.archiveWorktree(worktreeId);
      addToast('info', `Worktree "${worktree?.branch || 'unknown'}" archived`);
      // Force refresh worktrees to update UI immediately
      if (activeProjectId) {
        api.fetchWorktreesWithConflicts(activeProjectId).then(setWorktrees).catch(console.error);
      }
    } catch (err: any) {
      addToast('error', err.message || 'Failed to archive worktree');
    }
  }, [worktrees, addToast, activeProjectId, setWorktrees]);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    await api.deleteProject(projectId);
    removeProject(projectId);
  }, [removeProject]);

  const handleViewDiff = useCallback((worktreeId: string, branch: string) => {
    setDiffViewerState({ worktreeId, branch });
  }, []);

  const handleViewCommitDiff = useCallback((commitHash: string) => {
    setCommitDetailState({ commitHash, compareBase: null, compareTarget: null });
  }, []);

  const handleCompareCommits = useCallback((base: string, target: string) => {
    setCommitDetailState({ commitHash: null, compareBase: base, compareTarget: target });
  }, []);

  const activeWorktree = worktrees.find((w) => w.id === activeWorktreeId);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
      {/* Project tabs bar */}
      <ProjectTabBar
        onNewProject={() => setShowProjectModal(true)}
        showDashboard={showDashboard}
        onToggleDashboard={() => setShowDashboard(!showDashboard)}
      />

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-300 dark:border-zinc-700">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <h1 className="text-xl font-bold flex-shrink-0">Orchard</h1>
          {activeProject && (
            <span className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
              {activeProject.name}
              {activeWorktree && ` / ${activeWorktree.branch}`}
            </span>
          )}
          {/* OrchestratorStatus hidden - loop UI disabled */}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm text-zinc-500 dark:text-zinc-400 truncate max-w-xs mr-2">
            {activeWorktree ? activeWorktree.path : 'No worktree selected'}
          </span>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg transition-colors bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="p-2 rounded-lg transition-colors bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600"
            title="Settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* Main content */}
      {showDashboard ? (
        <Dashboard />
      ) : (
        <Group orientation="horizontal" className="flex-1 overflow-hidden">
          {/* Left sidebar: Terminal + Worktrees */}
          <Panel defaultSize={20} minSize={5}>
            <Sidebar
              onOpenProject={() => setShowProjectModal(true)}
              onCreateWorktree={() => setShowWorktreeModal(true)}
              onDeleteWorktree={handleDeleteWorktree}
              onArchiveWorktree={handleArchiveWorktree}
              onViewDiff={handleViewDiff}
              worktreeId={activeWorktreeId || undefined}
              worktreePath={activeWorktree?.path}
              projectPath={activeProject?.path}
            />
          </Panel>

          <Separator className="w-1 bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600 cursor-col-resize" />

          {/* Center: Chat (main focus) */}
          <Panel defaultSize={60} minSize={5}>
            {activeProjectId && activeProject ? (
              <div className="h-full flex flex-col bg-zinc-50 dark:bg-zinc-900">
                {/* Loop control hidden - see OrchestratorLoopControl if re-enabling */}
                <div className="flex-1 min-h-0 p-2">
                  <OrchestratorPanel projectId={activeProjectId} projectPath={activeProject.path} />
                </div>
              </div>
            ) : (
              <div className="h-full bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-500 dark:text-zinc-500">
                <div className="text-center">
                  <p>Open a project to get started</p>
                  <button
                    onClick={() => setShowProjectModal(true)}
                    className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded"
                  >
                    Open Project
                  </button>
                </div>
              </div>
            )}
          </Panel>

          {/* Right: Activity feed / Git History */}
          {activeProjectId && (
            <>
              <Separator className="w-1 bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600 cursor-col-resize" />
              <Panel defaultSize={20} minSize={5}>
                <div className="h-full flex flex-col bg-zinc-100 dark:bg-zinc-800">
                  {/* Tab switcher */}
                  <div className="flex border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
                    <button
                      onClick={() => setRightPanelTab('activity')}
                      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                        rightPanelTab === 'activity'
                          ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                      }`}
                    >
                      <Activity size={14} />
                      Activity
                    </button>
                    <button
                      onClick={() => setRightPanelTab('git-history')}
                      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                        rightPanelTab === 'git-history'
                          ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                      }`}
                    >
                      <GitCommit size={14} />
                      Git History
                    </button>
                  </div>
                  {/* Tab content */}
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {rightPanelTab === 'activity' ? (
                      <div className="h-full p-2">
                        <ActivityLog projectId={activeProjectId} />
                      </div>
                    ) : activeWorktreeId ? (
                      <GitHistorySidebar
                        worktreeId={activeWorktreeId}
                        onViewCommitDiff={handleViewCommitDiff}
                        onCompareCommits={handleCompareCommits}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
                        <p className="text-sm">Select a worktree to view git history</p>
                      </div>
                    )}
                  </div>
                </div>
              </Panel>
            </>
          )}
        </Group>
      )}

      {/* Modals */}
      <CreateProjectModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onSubmit={handleCreateProject}
        onOpenExisting={handleOpenExisting}
      />

      {activeProjectId && (
        <CreateWorktreeModal
          isOpen={showWorktreeModal}
          projectId={activeProjectId}
          onClose={() => setShowWorktreeModal(false)}
          onSubmit={handleCreateWorktree}
        />
      )}

      {diffViewerState && (
        <DiffViewerModal
          isOpen={!!diffViewerState}
          worktreeId={diffViewerState.worktreeId}
          worktreeBranch={diffViewerState.branch}
          onClose={() => setDiffViewerState(null)}
        />
      )}

      {commitDetailState && activeWorktreeId && (
        <CommitDetailModal
          isOpen={!!commitDetailState}
          worktreeId={activeWorktreeId}
          commitHash={commitDetailState.commitHash}
          compareBase={commitDetailState.compareBase}
          compareTarget={commitDetailState.compareTarget}
          onClose={() => setCommitDetailState(null)}
        />
      )}

      <KeyboardShortcutsModal
        isOpen={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />

      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
      />
    </div>
  );
}

export default App;
