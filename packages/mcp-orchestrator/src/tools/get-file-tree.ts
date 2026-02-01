import { logActivity } from '../utils/log-activity.js';

/**
 * Get the project file tree
 */
export async function getFileTree(
  apiBase: string,
  args: { projectId: string }
): Promise<string> {
  const { projectId } = args;

  // Get project info first
  const projectRes = await fetch(`${apiBase}/projects/${projectId}`);
  if (!projectRes.ok) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const project = await projectRes.json();

  // Use the files endpoint if available, otherwise return project path
  try {
    const filesRes = await fetch(`${apiBase}/files/tree?path=${encodeURIComponent(project.path)}`);
    if (filesRes.ok) {
      const tree = await filesRes.json();
      await logActivity(apiBase, 'action', 'orchestrator', `MCP: Retrieved file tree`, {}, projectId);
      return `File tree for ${project.name}:\n\n${JSON.stringify(tree, null, 2)}`;
    }
  } catch {
    // Files endpoint not available
  }

  await logActivity(apiBase, 'action', 'orchestrator', `MCP: Retrieved project path`, {}, projectId);
  return `Project path: ${project.path}\n\nNote: File tree endpoint not available. Use terminal to explore.`;
}
