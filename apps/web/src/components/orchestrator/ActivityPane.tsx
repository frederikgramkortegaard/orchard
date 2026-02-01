import { useState } from 'react';
import { Activity, BarChart3 } from 'lucide-react';
import { ActivityLog } from './ActivityLog';
import { UsageStats } from './UsageStats';

interface ActivityPaneProps {
  projectId: string;
}

type TabId = 'activity' | 'usage';

interface Tab {
  id: TabId;
  label: string;
  icon: typeof Activity;
}

const TABS: Tab[] = [
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'usage', label: 'AI Usage', icon: BarChart3 },
];

export function ActivityPane({ projectId }: ActivityPaneProps) {
  const [activeTab, setActiveTab] = useState<TabId>('activity');

  return (
    <div className="h-full flex flex-col bg-zinc-100 dark:bg-zinc-900 rounded-2xl overflow-hidden">
      {/* Tab Bar */}
      <div className="flex items-center bg-zinc-200 dark:bg-zinc-800 border-b border-zinc-300 dark:border-zinc-700">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400 bg-zinc-100 dark:bg-zinc-900 border-b-2 border-blue-500'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-300/50 dark:hover:bg-zinc-700/50'
              }`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'activity' && <ActivityLog projectId={projectId} />}
        {activeTab === 'usage' && <UsageStats projectId={projectId} />}
      </div>
    </div>
  );
}
