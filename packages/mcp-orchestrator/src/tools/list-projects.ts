/**
 * List all projects registered in Orchard
 */
export async function listProjects(apiBase: string): Promise<string> {
  // Get projects from Orchard API
  const res = await fetch(`${apiBase}/projects`);
  if (!res.ok) {
    throw new Error(`Failed to fetch projects: ${res.statusText}`);
  }

  const projects = await res.json();

  if (projects.length === 0) {
    return 'No projects found';
  }

  // Format output
  const lines = projects.map((p: { id: string; name: string; path: string }) => {
    return `- ${p.name} (${p.id})\n  Path: ${p.path}`;
  });

  return `Projects:\n${lines.join('\n')}`;
}
