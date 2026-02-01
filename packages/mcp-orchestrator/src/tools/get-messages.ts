import { logActivity } from '../utils/log-activity.js';

interface ChatMessage {
  id: string;
  projectId: string;
  text: string;
  timestamp: string;
  from: 'user' | 'orchestrator';
  replyTo?: string;
  status: string;
}

interface ProjectMessages {
  projectId: string;
  projectName: string;
  messages: ChatMessage[];
}

interface AllProjectsResponse {
  projects: ProjectMessages[];
  totalMessages: number;
}

/**
 * Get recent chat messages from the conversation history
 * If no projectId is specified or allProjects is true, returns messages from all open projects
 */
export async function getMessages(
  apiBase: string,
  args: { projectId?: string; limit?: number; unreadOnly?: boolean; allProjects?: boolean }
): Promise<string> {
  const { projectId, limit = 20, unreadOnly = false, allProjects = false } = args;

  // Build the URL based on whether we want all projects
  let url: string;
  if (allProjects || !projectId) {
    url = `${apiBase}/chat?allProjects=true&limit=${limit}`;
  } else {
    url = `${apiBase}/chat?projectId=${projectId}&limit=${limit}`;
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch chat: ${res.statusText}`);
  }

  const data = await res.json();

  // Handle all-projects response
  if (allProjects || !projectId) {
    const response = data as AllProjectsResponse;

    if (response.projects.length === 0) {
      return 'No open projects found.';
    }

    if (response.totalMessages === 0) {
      return `Found ${response.projects.length} project(s), but no messages yet.`;
    }

    // Format messages grouped by project
    const sections: string[] = [];

    for (const project of response.projects) {
      let messages = project.messages;

      // Optionally filter to user messages only
      if (unreadOnly) {
        messages = messages.filter(m => m.from === 'user');
      }

      if (messages.length === 0) {
        continue;
      }

      const formatted = messages.map((m) => {
        const time = new Date(m.timestamp).toLocaleTimeString();
        const date = new Date(m.timestamp).toLocaleDateString();
        const from = m.from === 'user' ? 'User' : 'Orchestrator';
        return `  [${date} ${time}] ${from}: ${m.text}`;
      }).join('\n');

      sections.push(`## Project: ${project.projectName} (${project.projectId})\n${formatted}`);
    }

    if (sections.length === 0) {
      return 'No messages found across all projects.';
    }

    await logActivity(apiBase, 'action', 'orchestrator', `MCP: Read messages from ${response.projects.length} project(s)`, {});

    return `Chat messages from all projects (${response.totalMessages} total):\n\n${sections.join('\n\n')}`;
  }

  // Handle single-project response (backward compatible)
  const messages = data as ChatMessage[];

  if (messages.length === 0) {
    return 'No messages yet.';
  }

  // Optionally filter to user messages only
  const filtered = unreadOnly
    ? messages.filter((m) => m.from === 'user')
    : messages;

  // Format messages with timestamp and sender
  const formatted = filtered.map((m) => {
    const time = new Date(m.timestamp).toLocaleTimeString();
    const date = new Date(m.timestamp).toLocaleDateString();
    const from = m.from === 'user' ? 'User' : 'Orchestrator';
    return `[${date} ${time}] ${from}: ${m.text}`;
  }).join('\n');

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Read ${filtered.length} chat messages`, {}, projectId);

  return `Chat messages (${filtered.length}):\n\n${formatted}`;
}
