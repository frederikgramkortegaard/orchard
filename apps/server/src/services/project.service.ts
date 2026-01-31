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

class ProjectService {
  private projects = new Map<string, Project>();

  async initialize(): Promise<void> {
    // Ensure orchard-projects directory exists
    if (!existsSync(ORCHARD_DIR)) {
      await mkdir(ORCHARD_DIR, { recursive: true });
    }

    // Load existing projects
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

  async createProjectFromLocal(localPath: string, name?: string, inPlace = false): Promise<Project> {
    // Verify it's a git repo
    if (!existsSync(join(localPath, '.git'))) {
      throw new Error('Not a git repository');
    }

    const git = simpleGit(localPath);
    const remotes = await git.getRemotes(true);
    const origin = remotes.find(r => r.name === 'origin');
    const repoUrl = origin?.refs?.fetch;

    const projectName = name || basename(localPath);

    if (inPlace) {
      // In-place mode: use the repo directly without cloning
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

      const project: Project = {
        ...config,
        path: projectPath,
      };

      this.projects.set(projectId, project);
      return project;
    }

    // Clone mode: copy to orchard-projects directory
    const projectPath = join(ORCHARD_DIR, projectName);
    const mainWorktreePath = join(projectPath, 'main');
    const orchardConfigPath = join(projectPath, '.orchard');

    // If project already exists, just reopen it
    if (existsSync(projectPath)) {
      const existing = await this.reopenProject(projectPath);
      if (existing) return existing;
    }

    // Create project structure
    await mkdir(projectPath, { recursive: true });
    await mkdir(orchardConfigPath, { recursive: true });

    // Clone from local path
    const gitClone = simpleGit();
    await gitClone.clone(localPath, mainWorktreePath);

    const projectId = randomUUID();
    const config: ProjectConfig = {
      id: projectId,
      name: projectName,
      repoUrl,
      createdAt: new Date().toISOString(),
    };

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

  async deleteProject(projectId: string): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project) return false;

    await rm(project.path, { recursive: true, force: true });
    this.projects.delete(projectId);
    return true;
  }

  getProject(projectId: string): Project | undefined {
    return this.projects.get(projectId);
  }

  getAllProjects(): Project[] {
    return Array.from(this.projects.values());
  }

  getMainWorktreePath(projectId: string): string | undefined {
    const project = this.projects.get(projectId);
    if (!project) return undefined;
    // In-place projects use the project path directly
    return project.inPlace ? project.path : join(project.path, 'main');
  }

  // Reopen an existing project from disk
  async reopenProject(projectPath: string): Promise<Project | null> {
    const configPath = join(projectPath, '.orchard', 'config.json');

    if (!existsSync(configPath)) {
      return null;
    }

    try {
      const config: ProjectConfig = JSON.parse(await readFile(configPath, 'utf-8'));

      // Check if already loaded
      const existing = this.projects.get(config.id);
      if (existing) {
        return existing;
      }

      const project: Project = {
        ...config,
        path: projectPath,
      };

      this.projects.set(config.id, project);
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
