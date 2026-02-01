import { ActivityLog } from './ActivityLog';

interface ActivityPaneProps {
  projectId: string;
  worktreeId?: string;
  worktreeBranch?: string;
}

export function ActivityPane({ projectId }: ActivityPaneProps) {
  return (
    <div className="h-full flex flex-col bg-zinc-900 overflow-hidden">
      <ActivityLog projectId={projectId} />
    </div>
  );
}
