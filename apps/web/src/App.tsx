import { useState, useEffect, useCallback } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useProjectStore } from './stores/project.store';
import { useToast } from './contexts/ToastContext';
import { ProjectTabBar } from './components/layout/ProjectTabBar';
import { Sidebar } from './components/sidebar/Sidebar';
import { CreateProjectModal } from './components/modals/CreateProjectModal';
import { KeyboardShortcutsModal } from './components/modals/KeyboardShortcutsModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { DiffViewerModal } from './components/diff';
import { OrchestratorPanel } from './components/orchestrator/OrchestratorPanel';
import { ActivityPane } from './components/orchestrator/ActivityPane';
import { SplitTerminalPane } from './components/terminal/SplitTerminalPane';
import { DebugPanel } from './components/DebugPanel';
import * as api from './api/projects';

function App() {
  const { addToast } = useToast();
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [diffViewerState, setDiffViewerState] = useState<{ worktreeId: string; branch: string } | null>(null);
  const [projectSwitchKey, setProjectSwitchKey] = useState(0);
  const {
    projects,
    activeProjectId,
    worktrees,
    activeWorktreeId,
    setProjects,
    setWorktrees,
    addProject,
    removeWorktree,
  } = useProjectStore();

  // Load projects on mount
  useEffect(() => {
    api.fetchProjects().then(setProjects).catch(console.error);
  }, [setProjects]);

  // Load worktrees when project changes
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

  const handleProjectSwitch = useCallback((projectId: string) => {
    api.fetchWorktreesWithConflicts(projectId).then(setWorktrees).catch(console.error);
    setProjectSwitchKey(prev => prev + 1);
  }, [setWorktrees]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowShortcutsModal(true);
      }

      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setShowSettingsModal(true);
      }

      if (e.key === 'Escape') {
        setShowShortcutsModal(false);
        setShowProjectModal(false);
        setShowSettingsModal(false);
        setShowDebugPanel(false);
        setDiffViewerState(null);
      }

      // Ctrl + 1-9 - Switch to project tab
      if (e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;
        if (index < projects.length) {
          e.preventDefault();
          useProjectStore.getState().setActiveProject(projects[index].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projects]);

  const handleCreateProject = useCallback(async (data: { repoUrl?: string; localPath?: string; name?: string; inPlace?: boolean }) => {
    const project = await api.createProject(data);
    addProject(project);
  }, [addProject]);

  const handleOpenExisting = useCallback((project: typeof projects[0]) => {
    addProject(project);
  }, [addProject]);

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

  const handleViewDiff = useCallback((worktreeId: string, branch: string) => {
    setDiffViewerState({ worktreeId, branch });
  }, []);

  const activeWorktree = worktrees.find((w) => w.id === activeWorktreeId);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="h-screen flex flex-col bg-zinc-900 text-zinc-100">
      <ProjectTabBar
        onNewProject={() => setShowProjectModal(true)}
        onProjectSwitch={handleProjectSwitch}
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenDebug={() => setShowDebugPanel(true)}
      />

      {activeProjectId && activeProject ? (
        <Group orientation="horizontal" className="flex-1 overflow-hidden">
          <Panel defaultSize={20} minSize={5}>
            <Sidebar
              onDeleteWorktree={handleDeleteWorktree}
              onArchiveWorktree={handleArchiveWorktree}
              onViewDiff={handleViewDiff}
              worktreeId={activeWorktreeId || undefined}
              worktreePath={activeWorktree?.path}
              projectPath={activeProject?.path}
            />
          </Panel>

          <Separator className="w-px bg-zinc-700 hover:bg-blue-500 dark:hover:bg-zinc-600 cursor-col-resize" />

          <Panel defaultSize={40} minSize={5}>
            <div className="h-full bg-zinc-900">
              <OrchestratorPanel key={`chat-${activeProjectId}-${projectSwitchKey}`} projectId={activeProjectId} projectPath={activeProject.path} />
            </div>
          </Panel>

          <Separator className="w-px bg-zinc-700 hover:bg-blue-500 dark:hover:bg-zinc-600 cursor-col-resize" />

          <Panel defaultSize={25} minSize={5}>
            <SplitTerminalPane
              key={`terminal-${activeProjectId}-${activeWorktreeId || 'none'}-${projectSwitchKey}`}
              worktreeId={activeWorktreeId || undefined}
              worktreePath={activeWorktree?.path}
              projectPath={activeProject?.path}
            />
          </Panel>

          <Separator className="w-px bg-zinc-700 hover:bg-blue-500 dark:hover:bg-zinc-600 cursor-col-resize" />
          <Panel defaultSize={20} minSize={5}>
            <ActivityPane
              key={`activity-${activeProjectId}-${projectSwitchKey}`}
              projectId={activeProjectId}
              worktreeId={activeWorktreeId || undefined}
              worktreeBranch={activeWorktree?.branch}
            />
          </Panel>
        </Group>
      ) : (
        <div className="flex-1 bg-zinc-900 flex items-center justify-center text-warm-muted">
          <div className="text-center">
            <p className="text-lg mb-2">Welcome to Orchard</p>
            <p className="text-sm mb-4">Open a project to get started</p>
            <button
              onClick={() => setShowProjectModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
            >
              Open Project
            </button>
          </div>
        </div>
      )}

      <CreateProjectModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onSubmit={handleCreateProject}
        onOpenExisting={handleOpenExisting}
      />

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

      <DebugPanel
        isOpen={showDebugPanel}
        onClose={() => setShowDebugPanel(false)}
      />
    </div>
  );
}

export default App;
