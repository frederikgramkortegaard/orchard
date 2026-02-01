import { LayoutDashboard, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useProjectStore } from '../../stores/project.store';
import { CommitsChart } from './CommitsChart';
import { MessagesChart } from './MessagesChart';
import { WorktreesCard } from './WorktreesCard';
import { AgentActivityCard } from './AgentActivityCard';

const APPROVAL_MESSAGE = 'Your plan is approved. Proceed with implementation.';

export function Dashboard() {
  const { activeProjectId, worktrees, projects } = useProjectStore();
  const [refreshKey, setRefreshKey] = useState(0);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const projectWorktrees = worktrees.filter((w) => w.projectId === activeProjectId);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  const handleApprove = async (worktreeId: string) => {
    try {
      // First, get the terminal sessions for this worktree
      const sessionsRes = await fetch(`/api/terminals/worktree/${worktreeId}`);
      if (!sessionsRes.ok) throw new Error('Failed to get sessions');
      const sessions = await sessionsRes.json();

      if (sessions.length === 0) {
        console.error('No active sessions for worktree');
        return;
      }

      // Send approval message to the first active session
      const sessionId = sessions[0].id;
      const inputRes = await fetch(`/api/terminals/${sessionId}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: APPROVAL_MESSAGE, sendEnter: true }),
      });

      if (!inputRes.ok) throw new Error('Failed to send approval');

      console.log(`Sent approval to worktree ${worktreeId}`);
    } catch (err) {
      console.error('Error approving plan:', err);
    }
  };

  if (!activeProjectId || !activeProject) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-900 text-zinc-500">
        <LayoutDashboard size={48} className="mb-4 opacity-50" />
        <p>Select a project to view dashboard</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-zinc-50 dark:bg-zinc-900 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <LayoutDashboard size={24} className="text-blue-500" />
            <div>
              <h1 className="text-xl font-bold">{activeProject.name} Dashboard</h1>
              <p className="text-sm text-zinc-500">{activeProject.path}</p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 rounded transition-colors"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6" key={refreshKey}>
          <CommitsChart projectId={activeProjectId} />
          <MessagesChart projectId={activeProjectId} />
        </div>

        {/* Activity Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <WorktreesCard worktrees={projectWorktrees} onApprove={handleApprove} />
          <AgentActivityCard projectId={activeProjectId} />
        </div>
      </div>
    </div>
  );
}
