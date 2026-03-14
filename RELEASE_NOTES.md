## New
- Re-enable close session confirmation from Settings > General ("Confirm before closing sessions" toggle)
- Frosted glass themes

## Fixed
- App no longer crashes when restoring 6-7 sessions simultaneously on startup
- Toast notifications are no longer hidden behind the title bar
- Drag-and-drop session reordering now has reliable, generous drop targets
- Deadlock in silence timer thread when multiple sessions are active
- Signal safety: validated process IDs before sending signals to prevent accidental process group kills
- Shell integration temp files are now cleaned up after the child process is killed, not before
- Infinite loop guard on corrupted UTF-8 data in session snapshot truncation
- Timer and event listener leaks on component unmount (closeSession, auto-updater stall timer)
- Orphaned terminals cleaned up when workspace restore fails mid-way

## Improved
- 12-19% faster PTY output processing (single ANSI strip pass, VecDeque evictions)
- Git status polling shared across sessions with same working directory
- Branch ahead/behind counts computed lazily after initial render
- Session state updates skip no-op reducer dispatches
- Metrics emission throttled to 5s wall-clock instead of every 30 chunks
- Shell foreground polling limited to focused terminal only
- Workspace auto-save skipped when nothing changed
