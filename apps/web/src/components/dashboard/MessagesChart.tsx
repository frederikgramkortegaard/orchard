import { useState, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import { SimpleLineChart } from './charts';

interface MessagesChartProps {
  projectId: string;
}

interface MessageData {
  date: string;
  count: number;
}

export function MessagesChart({ projectId }: MessagesChartProps) {
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchMessages = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/messages?days=14`);
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messagesByDay || []);
          setTotalMessages(data.totalMessages || 0);
        }
      } catch (err) {
        console.error('Failed to fetch messages:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMessages();
    const interval = setInterval(fetchMessages, 30000);
    return () => clearInterval(interval);
  }, [projectId]);

  const chartData = messages.map((m) => ({
    label: new Date(m.date).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    value: m.count,
  }));

  return (
    <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-green-500" />
          <h3 className="text-sm font-medium">Messages (14 days)</h3>
        </div>
        <span className="text-2xl font-bold text-green-500">{totalMessages}</span>
      </div>

      {isLoading ? (
        <div className="h-[120px] flex items-center justify-center text-zinc-500 text-sm">
          Loading...
        </div>
      ) : (
        <SimpleLineChart data={chartData} height={120} lineColor="#22c55e" fillColor="rgba(34, 197, 94, 0.1)" />
      )}
    </div>
  );
}
