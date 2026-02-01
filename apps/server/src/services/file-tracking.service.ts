import { simpleGit } from 'simple-git';
import { existsSync } from 'fs';
import { projectService } from './project.service.js';
import { worktreeService, type Worktree } from './worktree.service.js';
import { databaseService } from './database.service.js';

export interface FileLock {
  filePath: string;
  worktreeId: string;
  branch: string;
  status: 'modified' | 'staged' | 'untracked';
  lastModified: string;
}

export interface FileConflict {
  filePath: string;
  worktrees: Array<{
    worktreeId: string;
    branch: string;
    status: 'modified' | 'staged' | 'untracked';
  }>;
}

export interface ConflictWarning {
  type: 'overlap';
  message: string;
  files: string[];
  conflictingWorktrees: Array<{
    worktreeId: string;
    branch: string;
  }>;
}

class FileTrackingService {
  /**
   * Get all files currently being modified in a worktree
   */
  async getModifiedFiles(worktreePath: string): Promise<Array<{ path: string; status: 'modified' | 'staged' | 'untracked' }>> {
    if (!existsSync(worktreePath)) {
      return [];
    }

    const git = simpleGit(worktreePath);

    try {
      const status = await git.status();
      const files: Array<{ path: string; status: 'modified' | 'staged' | 'untracked' }> = [];

      // Modified files (unstaged)
      for (const file of status.modified) {
        files.push({ path: file, status: 'modified' });
      }

      // Staged files
      for (const file of status.staged) {
        // Avoid duplicates if file is in both modified and staged
        if (!files.some(f => f.path === file)) {
          files.push({ path: file, status: 'staged' });
        }
      }

      // Untracked files (new files being created)
      for (const file of status.not_added) {
        files.push({ path: file, status: 'untracked' });
      }

      // Created files
      for (const file of status.created) {
        if (!files.some(f => f.path === file)) {
          files.push({ path: file, status: 'staged' });
        }
      }

      return files;
    } catch {
      return [];
    }
  }

  /**
   * Get all file locks for a project (files being modified by any agent)
   */
  async getFileLocks(projectId: string): Promise<FileLock[]> {
    const worktrees = worktreeService.getWorktreesForProject(projectId);
    const locks: FileLock[] = [];

    for (const worktree of worktrees) {
      // Skip main worktree and archived worktrees
      if (worktree.isMain || worktree.archived) continue;

      const files = await this.getModifiedFiles(worktree.path);
      const now = new Date().toISOString();

      for (const file of files) {
        locks.push({
          filePath: file.path,
          worktreeId: worktree.id,
          branch: worktree.branch,
          status: file.status,
          lastModified: now,
        });
      }
    }

    return locks;
  }

  /**
   * Get file locks grouped by worktree
   */
  async getFileLocksGroupedByWorktree(projectId: string): Promise<Record<string, FileLock[]>> {
    const locks = await this.getFileLocks(projectId);
    const grouped: Record<string, FileLock[]> = {};

    for (const lock of locks) {
      if (!grouped[lock.worktreeId]) {
        grouped[lock.worktreeId] = [];
      }
      grouped[lock.worktreeId].push(lock);
    }

    return grouped;
  }

  /**
   * Detect files that are being modified by multiple agents
   */
  async detectConflicts(projectId: string): Promise<FileConflict[]> {
    const locks = await this.getFileLocks(projectId);
    const fileMap = new Map<string, FileLock[]>();

    // Group locks by file path
    for (const lock of locks) {
      if (!fileMap.has(lock.filePath)) {
        fileMap.set(lock.filePath, []);
      }
      fileMap.get(lock.filePath)!.push(lock);
    }

    // Find files with multiple worktrees
    const conflicts: FileConflict[] = [];
    for (const [filePath, fileLocks] of fileMap) {
      if (fileLocks.length > 1) {
        conflicts.push({
          filePath,
          worktrees: fileLocks.map(l => ({
            worktreeId: l.worktreeId,
            branch: l.branch,
            status: l.status,
          })),
        });
      }
    }

    return conflicts;
  }

  /**
   * Check if a new worktree would have file overlaps with existing active worktrees
   * This is called before creating a new agent to warn about potential conflicts
   */
  async checkForOverlaps(
    projectId: string,
    newWorktreeFiles?: string[]
  ): Promise<ConflictWarning | null> {
    const existingLocks = await this.getFileLocks(projectId);

    if (existingLocks.length === 0) {
      return null;
    }

    // If we don't have specific files to check, we can't determine overlap
    // This would be the case when creating a new agent without knowing what files it will touch
    if (!newWorktreeFiles || newWorktreeFiles.length === 0) {
      return null;
    }

    const overlappingFiles: string[] = [];
    const conflictingWorktrees = new Map<string, { worktreeId: string; branch: string }>();

    for (const lock of existingLocks) {
      if (newWorktreeFiles.includes(lock.filePath)) {
        overlappingFiles.push(lock.filePath);
        conflictingWorktrees.set(lock.worktreeId, {
          worktreeId: lock.worktreeId,
          branch: lock.branch,
        });
      }
    }

    if (overlappingFiles.length === 0) {
      return null;
    }

    return {
      type: 'overlap',
      message: `Potential conflict: ${overlappingFiles.length} file(s) are being modified by other agents`,
      files: overlappingFiles,
      conflictingWorktrees: Array.from(conflictingWorktrees.values()),
    };
  }

  /**
   * Log a conflict warning to the activity log
   */
  async logConflictWarning(
    projectId: string,
    newBranch: string,
    conflicts: FileConflict[]
  ): Promise<void> {
    const project = projectService.getProject(projectId);
    if (!project) return;

    const conflictingBranches = new Set<string>();
    const conflictingFiles: string[] = [];

    for (const conflict of conflicts) {
      conflictingFiles.push(conflict.filePath);
      for (const wt of conflict.worktrees) {
        conflictingBranches.add(wt.branch);
      }
    }

    // Remove the new branch from conflicting branches if present
    conflictingBranches.delete(newBranch);

    if (conflictingBranches.size === 0) return;

    const branchList = Array.from(conflictingBranches).join(', ');
    const summary = `Potential merge conflict: ${newBranch} may conflict with ${branchList}`;

    databaseService.addActivityLog(project.path, projectId, {
      type: 'event',
      category: 'worktree',
      summary,
      details: {
        warningType: 'file_conflict',
        newBranch,
        conflictingBranches: Array.from(conflictingBranches),
        conflictingFiles,
        fileCount: conflictingFiles.length,
      },
    });
  }

  /**
   * Check existing conflicts and log warnings for a newly created worktree
   * This should be called after the worktree starts modifying files
   */
  async checkAndLogConflictsForWorktree(worktreeId: string): Promise<FileConflict[]> {
    const worktree = worktreeService.getWorktree(worktreeId);
    if (!worktree) return [];

    const conflicts = await this.detectConflicts(worktree.projectId);

    // Filter to only conflicts involving this worktree
    const relevantConflicts = conflicts.filter(c =>
      c.worktrees.some(w => w.worktreeId === worktreeId)
    );

    if (relevantConflicts.length > 0) {
      await this.logConflictWarning(worktree.projectId, worktree.branch, relevantConflicts);
    }

    return relevantConflicts;
  }

  /**
   * Get worktrees that have potential conflicts (for UI display)
   */
  async getWorktreesWithConflicts(projectId: string): Promise<Map<string, string[]>> {
    const conflicts = await this.detectConflicts(projectId);
    const worktreeConflicts = new Map<string, string[]>();

    for (const conflict of conflicts) {
      for (const wt of conflict.worktrees) {
        if (!worktreeConflicts.has(wt.worktreeId)) {
          worktreeConflicts.set(wt.worktreeId, []);
        }
        worktreeConflicts.get(wt.worktreeId)!.push(conflict.filePath);
      }
    }

    return worktreeConflicts;
  }
}

export const fileTrackingService = new FileTrackingService();
