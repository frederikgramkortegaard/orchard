import { simpleGit } from 'simple-git';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';

export interface Project {
  id: string;
  name: string;
  path: string;
  repoUrl?: string;
  createdAt: string;
  inPlace?: boolean;
}

export interface ProjectConfig {
  id: string;
  name: string;
  repoUrl?: string;
  createdAt: string;
  inPlace?: boolean;
}

class ProjectService {
  private projects = new Map<string, Project>();

  async initialize(): Promise<void> {
    // Load project from current working directory's .orchard/config.json
    const cwd = process.cwd();
    const configPath = join(cwd, '.orchard', 'config.json');

    if (existsSync(configPath)) {
      try {
        const config: ProjectConfig = JSON.parse(await readFile(configPath, 'utf-8'));
        const project: Project = {
          ...config,
          path: cwd,
          inPlace: true,
        };
        this.projects.set(config.id, project);
        console.log(`[ProjectService] Loaded project "${config.name}" from ${cwd}`);
      } catch (err) {
        console.error('[ProjectService] Error loading project config:', err);
      }
    } else {
      console.log('[ProjectService] No .orchard/config.json found in current directory');
    }
  }

  // Create a new project config in the current directory
  async createProjectFromLocal(localPath: string, name?: string): Promise<Project> {
    // Verify it's a git repo
    if (!existsSync(join(localPath, '.git'))) {
      throw new Error('Not a git repository');
    }

    const git = simpleGit(localPath);
    const remotes = await git.getRemotes(true);
    const origin = remotes.find(r => r.name === 'origin');
    const repoUrl = origin?.refs?.fetch;

    const projectName = name || basename(localPath);
    const orchardConfigPath = join(localPath, '.orchard');
    const configPath = join(orchardConfigPath, 'config.json');

    // Check if already tracked
    if (existsSync(configPath)) {
      const existing = await this.reopenProject(localPath);
      if (existing) return existing;
    }

    // Create .orchard config in the repo
    await mkdir(orchardConfigPath, { recursive: true });

    const projectId = randomUUID();
    const config: ProjectConfig = {
      id: projectId,
      name: projectName,
      repoUrl,
      createdAt: new Date().toISOString(),
      inPlace: true,
    };

    await writeFile(configPath, JSON.stringify(config, null, 2));

    const project: Project = {
      ...config,
      path: localPath,
    };

    this.projects.set(projectId, project);
    return project;
  }

  getProject(projectIdOrName: string): Project | undefined {
    // Try by ID first
    const byId = this.projects.get(projectIdOrName);
    if (byId) return byId;
    // Fall back to lookup by name
    return Array.from(this.projects.values()).find(p => p.name === projectIdOrName);
  }

  getAllProjects(): Project[] {
    return Array.from(this.projects.values());
  }

  getMainWorktreePath(projectIdOrName: string): string | undefined {
    const project = this.getProject(projectIdOrName);
    if (!project) return undefined;
    // All projects are in-place now - project path is the main worktree
    return project.path;
  }

  // Reopen an existing project from disk
  async reopenProject(projectPath: string): Promise<Project | null> {
    const configPath = join(projectPath, '.orchard', 'config.json');

    try {
      let config: Partial<ProjectConfig> = {};

      // Load existing config if present
      if (existsSync(configPath)) {
        config = JSON.parse(await readFile(configPath, 'utf-8'));
      }

      // If missing required fields, create them
      if (!config.id || !config.name || !config.createdAt) {
        const projectName = basename(projectPath);
        config = {
          ...config,
          id: config.id || randomUUID(),
          name: config.name || projectName,
          createdAt: config.createdAt || new Date().toISOString(),
          inPlace: true,
        };

        // Ensure .orchard directory exists
        const orchardDir = join(projectPath, '.orchard');
        if (!existsSync(orchardDir)) {
          await mkdir(orchardDir, { recursive: true });
        }

        // Save the updated config
        await writeFile(configPath, JSON.stringify(config, null, 2));
        console.log(`[ProjectService] Created missing project config for ${projectPath}`);
      }

      // Check if already loaded
      const existing = this.projects.get(config.id!);
      if (existing) {
        return existing;
      }

      const project: Project = {
        id: config.id!,
        name: config.name!,
        createdAt: config.createdAt!,
        repoUrl: config.repoUrl,
        inPlace: config.inPlace,
        path: projectPath,
      };

      this.projects.set(config.id!, project);
      return project;
    } catch (err) {
      console.error('Error reopening project:', err);
      return null;
    }
  }

  // Get project by name (for reopening)
  getProjectByName(name: string): Project | undefined {
    return Array.from(this.projects.values()).find(p => p.name === name);
  }
}

export const projectService = new ProjectService();
