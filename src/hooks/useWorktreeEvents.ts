import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

export interface WorktreeCreateResult {
  worktree_path: string;
  branch_name: string;
  is_main_worktree: boolean;
}

/**
 * Subscribe to worktree lifecycle events for a given project.
 *
 * The backend emits:
 *   - `worktree-created-{projectId}` with a {@link WorktreeCreateResult} payload
 *   - `worktree-removed-{projectId}` with no payload
 *
 * Listeners are automatically cleaned up when the component unmounts or
 * `projectId` changes.
 */
export function useWorktreeEvents(
  projectId: string | null,
  callbacks: {
    onWorktreeCreated?: (data: WorktreeCreateResult) => void;
    onWorktreeRemoved?: () => void;
  },
) {
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    listen<WorktreeCreateResult>(`worktree-created-${projectId}`, (event) => {
      if (!cancelled) {
        callbacks.onWorktreeCreated?.(event.payload);
      }
    }).then((u) => {
      if (cancelled) {
        u();
      } else {
        unlisteners.push(u);
      }
    });

    listen(`worktree-removed-${projectId}`, () => {
      if (!cancelled) {
        callbacks.onWorktreeRemoved?.();
      }
    }).then((u) => {
      if (cancelled) {
        u();
      } else {
        unlisteners.push(u);
      }
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [projectId]);
}

/**
 * Subscribe to branch-change events for a given session.
 *
 * The backend emits `branch-changed-{sessionId}` with the new branch name
 * as a string payload whenever `git_checkout_branch` succeeds.
 */
export function useBranchChangeEvent(
  sessionId: string | null,
  onBranchChanged?: (branchName: string) => void,
) {
  useEffect(() => {
    if (!sessionId || !onBranchChanged) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<string>(`branch-changed-${sessionId}`, (event) => {
      if (!cancelled) {
        onBranchChanged(event.payload);
      }
    }).then((u) => {
      if (cancelled) {
        u();
      } else {
        unlisten = u;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [sessionId]);
}
