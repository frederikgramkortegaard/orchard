# Polish Issues - Orchard Multi-Agent Orchestrator

## Priority Levels
- **HIGH**: User-facing bugs or significant UX issues that affect daily usage
- **MEDIUM**: Minor UX issues, code quality improvements, or optimization opportunities
- **LOW**: Nice-to-have improvements, minor polish, cleanup

---

## HIGH Priority

### 1. ~~Context Menu Light Mode Not Supported~~ FIXED
**Location:** `apps/web/src/components/sidebar/Sidebar.tsx:347-398`
**Issue:** The worktree context menu has hardcoded dark theme colors (`bg-zinc-800`, `border-zinc-700`, `text-zinc-200`) that don't adapt to light mode, making it nearly invisible against dark backgrounds in light theme.
**Fix:** Add light mode variants using `dark:` prefix pattern.

### 2. ~~Duplicate Close Buttons in Terminal Panel~~ FIXED
**Location:** `apps/web/src/components/terminal/SplitTerminalPane.tsx:336-349`
**Issue:** Two identical close buttons (X and filled square) both call `closeTerminal()`. This is confusing - users don't know which to click.
**Fix:** Keep only one close button or differentiate their purposes (e.g., one for "close tab" vs "kill process").

### 3. No Confirmation for Destructive Actions
**Location:** `apps/web/src/components/sidebar/Sidebar.tsx:299-306`, `apps/web/src/App.tsx:118-127`
**Issue:** Delete worktree happens immediately without confirmation. Users can accidentally delete worktrees with uncommitted changes.
**Fix:** Add confirmation dialog for delete/archive actions.

### 4. ~~Rate Limit Wait Timer Not Auto-Updating~~ FIXED
**Location:** `apps/web/src/components/terminal/TerminalInstance.tsx:234-240`
**Issue:** The `getWaitTime()` function is computed once on render but doesn't auto-update, so the "Waiting: Xs" display stays stale.
**Fix:** Use `useState` with `setInterval` to update the timer display.

### 5. ~~Missing Clipboard Copy Feedback~~ FIXED
**Location:** `apps/web/src/components/sidebar/Sidebar.tsx:82-87`
**Issue:** When copying branch name, there's no visual feedback that the copy succeeded.
**Fix:** Add toast notification: `addToast('success', 'Branch name copied')`.

### 6. ~~Project Name Field Shows in Wrong Mode~~ FIXED
**Location:** `apps/web/src/components/modals/CreateProjectModal.tsx:182-191`
**Issue:** The "Project Name (optional)" field appears even when in "Recent" mode, where it doesn't apply.
**Fix:** Conditionally render the name field only for 'url' and 'local' modes.

---

## MEDIUM Priority

### 7. Inconsistent Error Handling
**Location:** Multiple files
**Issue:** Error handling is inconsistent - some places use `addToast('error', ...)`, others use `console.error()`, and some swallow errors silently.
**Files affected:**
- `apps/web/src/components/orchestrator/OrchestratorPanel.tsx:46-48` - empty catch blocks
- `apps/web/src/components/terminal/SplitTerminalPane.tsx:123-124` - console.error only
- `apps/web/src/components/sidebar/Sidebar.tsx:49-50` - toast used correctly
**Fix:** Standardize on toast notifications for user-facing errors, console.error for dev-only info.

### 8. Activity Log Parses JSON Multiple Times
**Location:** `apps/web/src/components/orchestrator/ActivityLog.tsx:44-51, 177-179`
**Issue:** `JSON.parse(entry.details || '{}')` is called multiple times per entry (in `getActivityKind()` and `extractAgentBranch()`).
**Fix:** Parse once and pass the parsed object, or memoize the parsing.

### 9. ~~Unused "pink" Theme Classes~~ FIXED
**Location:** `apps/web/src/components/Toast.tsx:13-17, 46, 50, 58, 66, 73, 81`
**Issue:** Toast component has `pink:` CSS variant classes that aren't used (no pink theme exists).
**Fix:** Remove unused pink theme variants.

### 10. ~~Console.log Statements in Production~~ PARTIALLY FIXED
**Location:** Multiple files
**Issue:** Debug console.log statements left in production code.
**Files affected:**
- ~~`apps/web/src/components/terminal/SplitTerminalPane.tsx:94, 102-104`~~ - FIXED
- ~~`apps/web/src/components/terminal/TerminalInstance.tsx`~~ - FIXED
- `apps/server/src/routes/worktrees.ts:68, 151, 186` - TODO
**Fix:** Remove or guard with `NODE_ENV !== 'production'`.

### 11. Multiple Polling Intervals Could Be Consolidated
**Location:** Multiple files
**Issue:** Different polling intervals (3s for chat, 5s for worktrees, 3s for activity log) lead to inconsistent update rates and unnecessary API load.
**Files:**
- `apps/web/src/App.tsx:52` - 5s for worktrees
- `apps/web/src/components/orchestrator/OrchestratorPanel.tsx:51, 76` - 5s, 3s
- `apps/web/src/components/orchestrator/ActivityLog.tsx:291` - 3s
**Fix:** Consider using WebSocket push instead of polling, or consolidate to a single poll interval.

### 12. Type Assertions with `any`
**Location:** Multiple files
**Issue:** Several places use `any` type assertions, reducing type safety.
**Examples:**
- `apps/web/src/components/terminal/SplitTerminalPane.tsx:103`
- `apps/web/src/components/orchestrator/OrchestratorPanel.tsx:18, 43`
- `apps/web/src/components/terminal/TerminalPane.tsx:43`
**Fix:** Create proper TypeScript interfaces for API responses.

### 13. Inconsistent Button Styling
**Location:** Throughout the codebase
**Issue:** Button backgrounds vary between `bg-zinc-100`, `bg-zinc-200`, `bg-zinc-700` inconsistently.
**Fix:** Create consistent button variants (primary, secondary, ghost) and use them consistently.

---

## LOW Priority

### 14. fetchWorktrees Duplicated Between Store and API
**Location:** `apps/web/src/stores/project.store.ts` and `apps/web/src/api/projects.ts:54-58`
**Issue:** The store has a `fetchWorktrees` action but there's also a separate `fetchWorktrees` function in the API module, leading to confusion about which to use.
**Fix:** Remove from store, keep in API module only.

### 15. Missing Return Type Annotations
**Location:** Multiple files
**Issue:** Some functions lack explicit return type annotations.
**Fix:** Add return types for better documentation and type safety.

### 16. Empty Utils Directory
**Location:** `packages/shared/src/utils/`
**Issue:** Directory exists but is empty.
**Fix:** Remove if unused, or add shared utilities.

### 17. WebSocket Disconnection Banner Could Be More Prominent
**Location:** `apps/web/src/components/terminal/SplitTerminalPane.tsx:383-387`
**Issue:** The disconnection banner is subtle and easy to miss.
**Fix:** Make more prominent or add global notification.

### 18. No Manual Refresh Button for Terminal Sessions
**Location:** `apps/web/src/components/terminal/SplitTerminalPane.tsx`
**Issue:** Users can't manually refresh the session list if it gets out of sync.
**Fix:** Add refresh button to terminal panel header.

### 19. Worktree Search Escape Key Behavior
**Location:** `apps/web/src/components/sidebar/Sidebar.tsx:178`
**Issue:** Pressing Escape clears the search but doesn't also blur the input.
**Fix:** Also blur the input on Escape for better UX.

### 20. Missing Accessibility Labels
**Location:** Throughout the codebase
**Issue:** Many buttons lack `aria-label` attributes for screen readers.
**Fix:** Add appropriate aria-labels to icon-only buttons.

---

## Summary

| Priority | Total | Fixed |
|----------|-------|-------|
| HIGH     | 6     | 5     |
| MEDIUM   | 7     | 2     |
| LOW      | 7     | 0     |
| **Total**| **20**| **7** |

## Commits Made

1. `fix: add light mode support to context menu and clipboard feedback` - Issues #1, #5
2. `fix: remove duplicate close button and cleanup debug logs` - Issues #2, #10 (partial)
3. `fix: hide project name field in Recent mode` - Issue #6
4. `fix: auto-update rate limit wait time display` - Issue #4
5. `chore: remove unused pink theme classes from Toast` - Issue #9

## Remaining Work

### HIGH Priority (1 remaining)
- [ ] #3 - Add confirmation dialog for destructive actions

### MEDIUM Priority (5 remaining)
- [ ] #7 - Standardize error handling
- [ ] #8 - Optimize Activity Log JSON parsing
- [ ] #10 - Remove remaining console.logs (server-side)
- [ ] #11 - Consolidate polling intervals
- [ ] #12 - Fix type assertions
- [ ] #13 - Standardize button styling

### LOW Priority (7 remaining)
- All items still pending
