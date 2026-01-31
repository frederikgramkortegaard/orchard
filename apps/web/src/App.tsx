import { useState, useEffect, useCallback } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Sun, Moon } from 'lucide-react';
import { useProjectStore } from './stores/project.store';
import { useTerminalStore } from './stores/terminal.store';
import { useEditorStore } from './stores/editor.store';
import { useTheme } from './contexts/ThemeContext';
import { useToast } from './contexts/ToastContext';
import { ProjectTabBar } from './components/layout/ProjectTabBar';
import { Sidebar } from './components/sidebar/Sidebar';
import { SplitTerminalPane } from './components/terminal/SplitTerminalPane';
import { CreateProjectModal } from './components/modals/CreateProjectModal';
import { CreateWorktreeModal } from './components/modals/CreateWorktreeModal';
import { EditorPane } from './components/editor';
import { ActivityLog } from './components/orchestrator/ActivityLog';
import { Dashboard } from './components/dashboard/Dashboard';
import * as api from './api/projects';

function App() {
  const { theme, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showWorktreeModal, setShowWorktreeModal] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
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

  // Load worktrees when project changes and poll for updates
  useEffect(() => {
    if (activeProjectId) {
      const fetchAndUpdate = () => {
        api.fetchWorktrees(activeProjectId).then(setWorktrees).catch(console.error);
      };
      fetchAndUpdate();
      const interval = setInterval(fetchAndUpdate, 5000);
      return () => clearInterval(interval);
    } else {
      setWorktrees([]);
    }
  }, [activeProjectId, setWorktrees]);

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

  const activeWorktree = worktrees.find((w) => w.id === activeWorktreeId);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const { closeAllFiles } = useEditorStore();

  // Close all open files when worktree changes
  useEffect(() => {
    closeAllFiles();
  }, [activeWorktreeId, closeAllFiles]);

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
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">Orchard</h1>
          {activeProject && (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {activeProject.name}
              {activeWorktree && ` / ${activeWorktree.branch}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {activeWorktree ? activeWorktree.path : 'No worktree selected'}
          </span>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      {/* Main content */}
      {showDashboard ? (
        <Dashboard />
      ) : (
        <Group orientation="horizontal" className="flex-1 overflow-hidden">
          {/* Resizable sidebar */}
          <Panel defaultSize={20} minSize={5}>
            <Sidebar
              onOpenProject={() => setShowProjectModal(true)}
              onCreateWorktree={() => setShowWorktreeModal(true)}
              onDeleteWorktree={handleDeleteWorktree}
              onArchiveWorktree={handleArchiveWorktree}
            />
          </Panel>

          <Separator className="w-1 bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600 cursor-col-resize" />

          <Panel defaultSize={60} minSize={5}>
            <Group orientation="vertical" className="h-full">
            {/* Editor area */}
            <Panel defaultSize={55} minSize={5}>
              {activeWorktree ? (
                <EditorPane worktreePath={activeWorktree.path} />
              ) : (
                <div className="h-full bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-500 dark:text-zinc-500">
                  {activeProject ? (
                    <div className="text-center">
                      <p>Select a worktree or create a new one</p>
                      <button
                        onClick={() => setShowWorktreeModal(true)}
                        className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded"
                      >
                        Create Worktree
                      </button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p>Open a project to get started</p>
                      <button
                        onClick={() => setShowProjectModal(true)}
                        className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded"
                      >
                        Open Project
                      </button>
                    </div>
                  )}
                </div>
              )}
            </Panel>

            <Separator className="h-1 bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600 cursor-row-resize" />

            {/* Terminal area */}
            <Panel defaultSize={45} minSize={5}>
              <SplitTerminalPane
                worktreeId={activeWorktreeId || undefined}
                worktreePath={activeWorktree?.path}
                projectPath={activeProject?.path}
              />
            </Panel>
            </Group>
          </Panel>

          {/* Orchestrator log panel on the right */}
          {activeProjectId && (
            <>
              <Separator className="w-1 bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600 cursor-col-resize" />
              <Panel defaultSize={20} minSize={5}>
                <div className="h-full p-2 bg-zinc-100 dark:bg-zinc-800">
                  <ActivityLog projectId={activeProjectId} />
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
    </div>
  );
}

export default App;
