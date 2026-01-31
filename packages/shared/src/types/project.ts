export interface Project {
  id: string;
  name: string;
  path: string;           // Absolute path to project folder
  repoUrl?: string;       // Original clone URL
  createdAt: string;
}

export interface ProjectConfig {
  id: string;
  name: string;
  repoUrl?: string;
  createdAt: string;
}
