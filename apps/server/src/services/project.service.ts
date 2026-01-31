import { simpleGit, SimpleGit } from 'simple-git';
import { mkdir, readFile, writeFile, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import { homedir } from 'os';

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
  inPlace?: boolean; // true if project uses repo directly without cloning
}

const ORCHARD_DIR = join(homedir(), 'orchard-projects');
// Store in-place registry alongside cloned projects (not in ~/.orchard/)
const IN_PLACE_REGISTRY = join(ORCHARD_DIR, 'in-place-projects.json');

class ProjectService {
  private projects = new Map<string, Project>();

  async initialize(): Promise<void> {
    // Ensure orchard-projects directory exists
    if (!existsSync(ORCHARD_DIR)) {
      await mkdir(ORCHARD_DIR, { recursive: true });
    }

    // Load cloned projects from orchard-projects directory
    try {
      const dirs = await readdir(ORCHARD_DIR, { withFileTypes: true });
      for (const dir of dirs) {
        if (dir.isDirectory()) {
          const configPath = join(ORCHARD_DIR, dir.name, '.orchard', 'config.json');
          if (existsSync(configPath)) {
            const config: ProjectConfig = JSON.parse(await readFile(configPath, 'utf-8'));
            this.projects.set(config.id, {
              ...config,
              path: join(ORCHARD_DIR, dir.name),
            });
          }
        }
      }
    } catch (err) {
      console.error('Error loading projects:', err);
    }

    // Load in-place projects from registry
    await this.loadInPlaceProjects();
  }

  private async loadInPlaceProjects(): Promise<void> {
    if (!existsSync(IN_PLACE_REGISTRY)) {
      return;
    }

    try {
      const registry: string[] = JSON.parse(await readFile(IN_PLACE_REGISTRY, 'utf-8'));
      for (const projectPath of registry) {
        if (existsSync(projectPath)) {
          await this.reopenProject(projectPath);
        }
      }
    } catch (err) {
      console.error('Error loading in-place projects registry:', err);
    }
  }

  private async registerInPlaceProject(projectPath: string): Promise<void> {
    let registry: string[] = [];

    if (existsSync(IN_PLACE_REGISTRY)) {
      try {
        registry = JSON.parse(await readFile(IN_PLACE_REGISTRY, 'utf-8'));
      } catch {
        registry = [];
      }
    }

    if (!registry.includes(projectPath)) {
      registry.push(projectPath);
      await writeFile(IN_PLACE_REGISTRY, JSON.stringify(registry, null, 2));
    }
  }

  async createProject(repoUrl: string, name?: string): Promise<Project> {
    const projectName = name || this.extractRepoName(repoUrl);
    const projectPath = join(ORCHARD_DIR, projectName);
    const mainWorktreePath = join(projectPath, 'main');
    const orchardConfigPath = join(projectPath, '.orchard');

    // If project already exists, just reopen it
    if (existsSync(projectPath)) {
      const existing = await this.reopenProject(projectPath);
      if (existing) return existing;
      // If reopen failed, the config might be missing - recreate it
    }

    // Create project structure
    await mkdir(projectPath, { recursive: true });
    await mkdir(orchardConfigPath, { recursive: true });

    // Clone repository into main worktree
    const git = simpleGit();
    await git.clone(repoUrl, mainWorktreePath);

    const projectId = randomUUID();
    const config: ProjectConfig = {
      id: projectId,
      name: projectName,
      repoUrl,
      createdAt: new Date().toISOString(),
    };

    // Save config
    await writeFile(
      join(orchardConfigPath, 'config.json'),
      JSON.stringify(config, null, 2)
    );

    // Create Claude settings for project-wide permissions
    await this.setupClaudePermissions(mainWorktreePath, projectPath);

    const project: Project = {
      ...config,
      path: projectPath,
    };

    this.projects.set(projectId, project);
    return project;
  }

  // Set up Claude permissions for a worktree to allow access to entire project folder
  async setupClaudePermissions(worktreePath: string, projectPath: string): Promise<void> {
    const claudeDir = join(worktreePath, '.claude');
    const settingsPath = join(claudeDir, 'settings.local.json');

    try {
      if (!existsSync(claudeDir)) {
        await mkdir(claudeDir, { recursive: true });
      }

      const settings = {
        permissions: {
          allow: [
            `Bash(${projectPath}/**)`,  // Allow bash in project folder
            `Read(${projectPath}/**)`,  // Allow reading in project folder
            `Write(${projectPath}/**)`, // Allow writing in project folder
            `Edit(${projectPath}/**)`,  // Allow editing in project folder
          ],
          deny: []
        }
      };

      await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    } catch (err) {
      console.error('Error setting up Claude permissions:', err);
    }
  }

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
    const projectPath = localPath;
    const orchardConfigPath = join(projectPath, '.orchard');

    // Check if already tracked
    const configPath = join(orchardConfigPath, 'config.json');
    if (existsSync(configPath)) {
      const existing = await this.reopenProject(projectPath);
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

    // Register in in-place projects registry so it's found on restart
    await this.registerInPlaceProject(projectPath);

    const project: Project = {
      ...config,
      path: projectPath,
    };

    this.projects.set(projectId, project);
    return project;
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project) return false;

    await rm(project.path, { recursive: true, force: true });
    this.projects.delete(projectId);
    return true;
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
    // In-place projects use the project path directly
    return project.inPlace ? project.path : join(project.path, 'main');
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

  private extractRepoName(url: string): string {
    const match = url.match(/\/([^\/]+?)(\.git)?$/);
    return match ? match[1] : 'project';
  }
}

export const projectService = new ProjectService();
