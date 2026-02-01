import { useState, useEffect, useCallback } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Sun, Moon, Settings } from 'lucide-react';
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
import { ActivityPane } from './components/orchestrator/ActivityPane';
import { Dashboard } from './components/dashboard/Dashboard';
import { LoopStatusBadge } from './components/LoopStatusBadge';
import * as api from './api/projects';

function App() {
  const { theme, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showWorktreeModal, setShowWorktreeModal] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [diffViewerState, setDiffViewerState] = useState<{ worktreeId: string; branch: string } | null>(null);
  // Counter to force remount of project-dependent components on switch for instant data refresh
  const [projectSwitchKey, setProjectSwitchKey] = useState(0);
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

  // Handle project tab switch - trigger immediate fetches for instant feel
  const handleProjectSwitch = useCallback((projectId: string) => {
    // Immediately fetch worktrees for the new project
    api.fetchWorktreesWithConflicts(projectId).then(setWorktrees).catch(console.error);
    // Increment switch key to force remount of project-dependent components
    // This ensures chat and activity components immediately fetch fresh data
    setProjectSwitchKey(prev => prev + 1);
  }, [setWorktrees]);

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
      }

      // Ctrl + 1-9 (without Cmd) - Switch to project tab
      if (e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;
        if (index < projects.length) {
          e.preventDefault();
          useProjectStore.getState().setActiveProject(projects[index].id);
        }
        return;
      }

      // Cmd + 1-9 - Switch to worktree
      if (e.metaKey && e.key >= '1' && e.key <= '9') {
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
  }, [projects, worktrees]);

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
    } catch (err: any) {
      addToast('error', err.message || 'Failed to archive worktree');
    }
  }, [worktrees, addToast]);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    await api.deleteProject(projectId);
    removeProject(projectId);
  }, [removeProject]);

  const handleViewDiff = useCallback((worktreeId: string, branch: string) => {
    setDiffViewerState({ worktreeId, branch });
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
        onProjectSwitch={handleProjectSwitch}
      />

      {/* Header */}
      <header className="flex items-center h-11 px-4 bg-gradient-to-r from-zinc-50 to-zinc-100 dark:from-zinc-800 dark:to-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700">
        {/* Left section - Project/Branch info */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {activeProject ? (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
              <h1 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                {activeProject.name}
              </h1>
              {activeWorktree && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-600">/</span>
                  <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400 truncate">
                    {activeWorktree.branch}
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-zinc-400 dark:bg-zinc-500" />
              <h1 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Orchard</h1>
            </div>
          )}
        </div>

        {/* Right section - Actions */}
        <div className="flex items-center gap-2">
          {activeProjectId && <LoopStatusBadge projectId={activeProjectId} />}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="p-2 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors"
            title="Settings"
          >
            <Settings size={16} />
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
                <div className="flex-1 min-h-0 p-2">
                  <OrchestratorPanel key={`chat-${activeProjectId}-${projectSwitchKey}`} projectId={activeProjectId} projectPath={activeProject.path} />
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

          {/* Right: Activity feed / Orchestrator log */}
          {activeProjectId && (
            <>
              <Separator className="w-1 bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600 cursor-col-resize" />
              <Panel defaultSize={20} minSize={5}>
                <div className="h-full p-2 bg-zinc-100 dark:bg-zinc-800">
                  <ActivityPane
                    key={`activity-${activeProjectId}-${projectSwitchKey}`}
                    projectId={activeProjectId}
                    worktreeId={activeWorktreeId || undefined}
                    worktreeBranch={activeWorktree?.branch}
                  />
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
