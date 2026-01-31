# Undo and Revert Operations

Since Orchard is built on git, we can leverage git's powerful history management to undo/revert changes.

## Reverting a Merged Feature

When a feature was merged but needs to be removed:

```bash
# Find the merge commit
git log --oneline | grep -i "<feature-name>"

# Revert the merge (use -m 1 to keep mainline parent)
git revert <merge-commit-hash> --no-edit -m 1
```

This creates a new commit that undoes all changes from the feature, preserving history.

## Undoing Uncommitted Changes

```bash
# Discard all uncommitted changes (CAREFUL!)
git checkout -- .

# Or discard changes in a specific file
git checkout -- <file-path>
```

## Undoing the Last Commit (before push)

```bash
# Keep changes but uncommit
git reset --soft HEAD~1

# Discard changes completely
git reset --hard HEAD~1
```

## Reverting a Specific Commit

```bash
# Revert a non-merge commit
git revert <commit-hash> --no-edit
```

## Recovering a Deleted Branch

```bash
# Find the commit hash
git reflog | grep "<branch-name>"

# Recreate the branch
git checkout -b <branch-name> <commit-hash>
```

## Best Practices

1. **Always use revert over reset** for shared branches - preserves history
2. **Create a new worktree** to test revert before applying to master
3. **Rebuild after reverting** to ensure everything still works
4. **Archive reverted worktrees** instead of deleting to preserve history

## When to Use Each Approach

| Situation | Approach |
|-----------|----------|
| Merged feature needs removal | `git revert -m 1` |
| Work in progress needs discard | `git checkout -- .` |
| Wrong commit message | `git commit --amend` |
| Multiple commits to undo | Revert each in reverse order |
| Testing an undo | Create worktree first |
