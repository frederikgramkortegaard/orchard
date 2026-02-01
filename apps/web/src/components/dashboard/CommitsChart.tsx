import { useState, useEffect } from 'react';
import { GitCommit } from 'lucide-react';
import { SimpleBarChart } from './charts';

interface CommitsChartProps {
  projectId: string;
}

interface CommitData {
  date: string;
  count: number;
  author?: string;
}

export function CommitsChart({ projectId }: CommitsChartProps) {
  const [commits, setCommits] = useState<CommitData[]>([]);
  const [totalCommits, setTotalCommits] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchCommits = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/commits?days=14`);
        if (res.ok) {
          const data = await res.json();
          setCommits(data.commitsByDay || []);
          setTotalCommits(data.totalCommits || 0);
        }
      } catch (err) {
        console.error('Failed to fetch commits:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCommits();
    const interval = setInterval(fetchCommits, 30000);
    return () => clearInterval(interval);
  }, [projectId]);

  const chartData = commits.map((c) => ({
    label: new Date(c.date).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    value: c.count,
  }));

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-xl border border-zinc-200 dark:border-neutral-700 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-blue-500/10 dark:bg-blue-500/20 rounded-lg">
            <GitCommit size={14} className="text-blue-500" />
          </div>
          <h3 className="text-sm font-semibold">Commits (14 days)</h3>
        </div>
        <span className="text-2xl font-bold text-blue-500">{totalCommits}</span>
      </div>

      {isLoading ? (
        <div className="h-[120px] flex items-center justify-center text-zinc-400 dark:text-zinc-500 text-sm">
          Loading...
        </div>
      ) : (
        <SimpleBarChart data={chartData} height={120} barColor="#3b82f6" />
      )}
    </div>
  );
}
