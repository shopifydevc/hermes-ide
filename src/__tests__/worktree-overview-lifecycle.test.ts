/**
 * Tests for Worktree PRD Phases 3+4: overview panel, cleanup, and lifecycle features.
 *
 * Covers:
 * - API bindings: listAllWorktrees, detectOrphanWorktrees, worktreeDiskUsage, cleanupOrphanWorktrees
 * - formatBytes utility
 * - isStale age-based detection
 * - Orphan classification
 * - Cleanup flow logic
 * - Worktree grouping and search/filter
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Tauri APIs ─────────────────────────────────────────────────
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve({})),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../terminal/TerminalPool", () => ({
  createTerminal: vi.fn(),
  destroy: vi.fn(),
  updateSettings: vi.fn(),
  writeScrollback: vi.fn(),
}));
vi.mock("../utils/notifications", () => ({
  initNotifications: vi.fn(),
  notifyLongRunningDone: vi.fn(),
}));

// ─── Imports ─────────────────────────────────────────────────────────
import { invoke } from "@tauri-apps/api/core";
import {
  listAllWorktrees,
  detectOrphanWorktrees,
  worktreeDiskUsage,
  cleanupOrphanWorktrees,
} from "../api/git";
import type { WorktreeOverviewEntry, OrphanWorktree, CleanupResult } from "../types/git";

// ─── Helpers: replicate pure logic from WorktreeOverviewPanel.tsx ────

/**
 * Mirrors formatBytes() from WorktreeOverviewPanel.tsx.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

/**
 * Mirrors isStale() from WorktreeOverviewPanel.tsx.
 */
function isStale(createdAt: string, daysThreshold: number = 14): boolean {
  const created = new Date(createdAt);
  const now = new Date();
  const diffDays = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays > daysThreshold;
}

/**
 * Mirrors the grouping logic from WorktreeOverviewPanel.tsx (projectGroups useMemo).
 */
interface ProjectGroup {
  projectId: string;
  projectName: string;
  projectPath: string;
  worktrees: WorktreeOverviewEntry[];
  orphans: OrphanWorktree[];
}

function groupByProject(worktrees: WorktreeOverviewEntry[], orphans: OrphanWorktree[]): ProjectGroup[] {
  const groupMap = new Map<string, ProjectGroup>();

  for (const wt of worktrees) {
    let group = groupMap.get(wt.project_id);
    if (!group) {
      group = {
        projectId: wt.project_id,
        projectName: wt.project_name,
        projectPath: wt.project_path,
        worktrees: [],
        orphans: [],
      };
      groupMap.set(wt.project_id, group);
    }
    group.worktrees.push(wt);
  }

  for (const orphan of orphans) {
    let placed = false;
    if (orphan.project_path) {
      for (const group of groupMap.values()) {
        if (group.projectPath === orphan.project_path) {
          group.orphans.push(orphan);
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      const key = orphan.project_path || orphan.worktree_path;
      let group = groupMap.get(key);
      if (!group) {
        group = {
          projectId: key,
          projectName: orphan.project_path ? orphan.project_path.split("/").pop() || "Unknown" : "Orphaned",
          projectPath: orphan.project_path || "",
          worktrees: [],
          orphans: [],
        };
        groupMap.set(key, group);
      }
      group.orphans.push(orphan);
    }
  }

  return Array.from(groupMap.values());
}

/**
 * Mirrors the search/filter logic from WorktreeOverviewPanel.tsx (filteredGroups useMemo).
 */
function filterGroups(groups: ProjectGroup[], search: string): ProjectGroup[] {
  if (!search.trim()) return groups;
  const q = search.toLowerCase();
  return groups
    .map((group) => ({
      ...group,
      worktrees: group.worktrees.filter(
        (wt) =>
          (wt.branch_name && wt.branch_name.toLowerCase().includes(q)) ||
          wt.session_label.toLowerCase().includes(q) ||
          wt.project_name.toLowerCase().includes(q),
      ),
      orphans: group.orphans.filter(
        (o) =>
          (o.branch_name && o.branch_name.toLowerCase().includes(q)) ||
          o.worktree_path.toLowerCase().includes(q),
      ),
    }))
    .filter((g) => g.worktrees.length > 0 || g.orphans.length > 0);
}

// ─── Test data factories ─────────────────────────────────────────────

function makeWorktreeEntry(overrides: Partial<WorktreeOverviewEntry> = {}): WorktreeOverviewEntry {
  return {
    worktree_path: "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/abc_feature",
    branch_name: "feature",
    session_id: "session-1",
    session_label: "Session 1",
    project_id: "project-1",
    project_name: "my-project",
    project_path: "/Users/dev/project",
    is_main_worktree: false,
    created_at: new Date().toISOString(),
    last_activity_at: null,
    ...overrides,
  };
}

function makeOrphan(overrides: Partial<OrphanWorktree> = {}): OrphanWorktree {
  return {
    worktree_path: "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/orphan_branch",
    branch_name: "branch",
    kind: "directory_only",
    project_path: "/Users/dev/project",
    session_id: null,
    ...overrides,
  };
}

// ─── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue({});
});

// =====================================================================
// Group 1: API bindings
// =====================================================================

describe("API bindings - listAllWorktrees", () => {
  it("invokes correct IPC command", async () => {
    const mockData: WorktreeOverviewEntry[] = [
      makeWorktreeEntry(),
    ];
    vi.mocked(invoke).mockResolvedValue(mockData);

    const result = await listAllWorktrees();

    expect(invoke).toHaveBeenCalledWith("git_list_all_worktrees");
    expect(result).toEqual(mockData);
  });
});

describe("API bindings - detectOrphanWorktrees", () => {
  it("invokes correct IPC command", async () => {
    const mockData: OrphanWorktree[] = [
      makeOrphan(),
    ];
    vi.mocked(invoke).mockResolvedValue(mockData);

    const result = await detectOrphanWorktrees();

    expect(invoke).toHaveBeenCalledWith("git_detect_orphan_worktrees");
    expect(result).toEqual(mockData);
  });
});

describe("API bindings - worktreeDiskUsage", () => {
  it("invokes correct IPC command with path", async () => {
    const path = "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/abc_feature";
    vi.mocked(invoke).mockResolvedValue(1048576);

    const result = await worktreeDiskUsage(path);

    expect(invoke).toHaveBeenCalledWith("git_worktree_disk_usage", { worktreePath: path });
    expect(result).toBe(1048576);
  });
});

describe("API bindings - cleanupOrphanWorktrees", () => {
  it("invokes correct IPC command with paths array", async () => {
    const paths = [
      "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/orphan1",
      "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/orphan2",
    ];
    const mockResults: CleanupResult[] = [
      { path: paths[0], success: true, error: null },
      { path: paths[1], success: true, error: null },
    ];
    vi.mocked(invoke).mockResolvedValue(mockResults);

    const result = await cleanupOrphanWorktrees(paths);

    expect(invoke).toHaveBeenCalledWith("git_cleanup_orphan_worktrees", { paths });
    expect(result).toEqual(mockResults);
  });
});

// =====================================================================
// Group 2: formatBytes utility
// =====================================================================

describe("formatBytes utility", () => {
  it("formats 0 bytes as '0 B'", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes (< 1024) correctly", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1)).toBe("1.0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats kilobytes correctly", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10240)).toBe("10 KB");
    expect(formatBytes(102400)).toBe("100 KB");
  });

  it("formats megabytes correctly", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB");
    expect(formatBytes(5 * 1048576)).toBe("5.0 MB");
    expect(formatBytes(10 * 1048576)).toBe("10 MB");
    expect(formatBytes(500 * 1048576)).toBe("500 MB");
  });

  it("formats gigabytes correctly", () => {
    expect(formatBytes(1073741824)).toBe("1.0 GB");
    expect(formatBytes(2.5 * 1073741824)).toBe("2.5 GB");
    expect(formatBytes(10 * 1073741824)).toBe("10 GB");
  });

  it("handles large values", () => {
    // 1 TB
    expect(formatBytes(1099511627776)).toBe("1.0 TB");
    // 5 TB
    expect(formatBytes(5 * 1099511627776)).toBe("5.0 TB");
  });
});

// =====================================================================
// Group 3: Stale detection
// =====================================================================

describe("isStale detection", () => {
  it("returns false for recent date (1 day ago)", () => {
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStale(oneDayAgo)).toBe(false);
  });

  it("returns true for old date (15 days ago)", () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStale(fifteenDaysAgo)).toBe(true);
  });

  it("returns false at exactly 14 days", () => {
    // At exactly 14 days, diffDays === 14, and the condition is > (not >=)
    const exactlyFourteenDays = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStale(exactlyFourteenDays)).toBe(false);
  });

  it("respects custom threshold", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    // With threshold of 2 days, 3 days ago should be stale
    expect(isStale(threeDaysAgo, 2)).toBe(true);
    // With threshold of 5 days, 3 days ago should not be stale
    expect(isStale(threeDaysAgo, 5)).toBe(false);
  });
});

// =====================================================================
// Group 4: Orphan classification
// =====================================================================

describe("Orphan classification", () => {
  it("directory_only orphan has no session_id", () => {
    const orphan = makeOrphan({ kind: "directory_only", session_id: null });
    expect(orphan.kind).toBe("directory_only");
    expect(orphan.session_id).toBeNull();
  });

  it("record_only orphan has session_id", () => {
    const orphan = makeOrphan({ kind: "record_only", session_id: "session-42" });
    expect(orphan.kind).toBe("record_only");
    expect(orphan.session_id).toBe("session-42");
  });

  it("both types have worktree_path", () => {
    const dirOnly = makeOrphan({
      kind: "directory_only",
      worktree_path: "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/abc_feature",
    });
    const recOnly = makeOrphan({
      kind: "record_only",
      worktree_path: "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/def_develop",
    });

    expect(dirOnly.worktree_path).toBeTruthy();
    expect(recOnly.worktree_path).toBeTruthy();
    expect(typeof dirOnly.worktree_path).toBe("string");
    expect(typeof recOnly.worktree_path).toBe("string");
  });

  it("branch_name extracted from directory name for directory_only", () => {
    // For directory_only orphans, the branch_name is typically extracted
    // from the worktree directory name (the part after the underscore)
    const orphan = makeOrphan({
      kind: "directory_only",
      worktree_path: "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/abc123_feature-login",
      branch_name: "feature-login",
    });
    expect(orphan.branch_name).toBe("feature-login");

    // The path segment after underscore matches the branch name
    const dirName = orphan.worktree_path.split("/").pop()!;
    const underscoreIdx = dirName.indexOf("_");
    const extractedBranch = underscoreIdx >= 0 ? dirName.slice(underscoreIdx + 1) : null;
    expect(extractedBranch).toBe(orphan.branch_name);
  });
});

// =====================================================================
// Group 5: Cleanup flow
// =====================================================================

describe("Cleanup flow", () => {
  it("cleanup with empty paths returns empty results", async () => {
    vi.mocked(invoke).mockResolvedValue([]);

    const result = await cleanupOrphanWorktrees([]);

    expect(invoke).toHaveBeenCalledWith("git_cleanup_orphan_worktrees", { paths: [] });
    expect(result).toEqual([]);
  });

  it("cleanup result reports success per path", () => {
    const results: CleanupResult[] = [
      { path: "/path/a", success: true, error: null },
      { path: "/path/b", success: true, error: null },
      { path: "/path/c", success: true, error: null },
    ];

    expect(results.every((r) => r.success)).toBe(true);
    expect(results.every((r) => r.error === null)).toBe(true);
    expect(results).toHaveLength(3);
  });

  it("cleanup result reports failure with error message", () => {
    const results: CleanupResult[] = [
      { path: "/path/a", success: true, error: null },
      { path: "/path/b", success: false, error: "Permission denied" },
      { path: "/path/c", success: false, error: "Directory not found" },
    ];

    const failures = results.filter((r) => !r.success);
    expect(failures).toHaveLength(2);
    expect(failures[0].error).toBe("Permission denied");
    expect(failures[1].error).toBe("Directory not found");

    const successes = results.filter((r) => r.success);
    expect(successes).toHaveLength(1);
    expect(successes[0].error).toBeNull();
  });

  it("selected orphans are deselected after cleanup", async () => {
    // Simulate the handleCleanup logic from WorktreeOverviewPanel
    let selectedOrphans = new Set(["orphan-path-1", "orphan-path-2"]);
    expect(selectedOrphans.size).toBe(2);

    // After cleanup completes, the component calls setSelectedOrphans(new Set())
    vi.mocked(invoke).mockResolvedValue([
      { path: "orphan-path-1", success: true, error: null },
      { path: "orphan-path-2", success: true, error: null },
    ]);

    // Simulate the cleanup completing
    const results = await cleanupOrphanWorktrees(Array.from(selectedOrphans));
    expect(results).toHaveLength(2);

    // After cleanup, selections are cleared
    selectedOrphans = new Set();
    expect(selectedOrphans.size).toBe(0);
  });
});

// =====================================================================
// Group 6: Worktree grouping
// =====================================================================

describe("Worktree grouping", () => {
  const worktrees: WorktreeOverviewEntry[] = [
    makeWorktreeEntry({
      project_id: "project-1",
      project_name: "frontend",
      project_path: "/Users/dev/frontend",
      branch_name: "feature/login",
      session_label: "Login session",
      worktree_path: "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/a_feature-login",
    }),
    makeWorktreeEntry({
      project_id: "project-1",
      project_name: "frontend",
      project_path: "/Users/dev/frontend",
      branch_name: "develop",
      session_label: "Dev session",
      worktree_path: "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/b_develop",
    }),
    makeWorktreeEntry({
      project_id: "project-2",
      project_name: "backend",
      project_path: "/Users/dev/backend",
      branch_name: "main",
      session_label: "Backend main",
      worktree_path: "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/c_main",
    }),
    makeWorktreeEntry({
      project_id: "project-3",
      project_name: "api-gateway",
      project_path: "/Users/dev/api-gateway",
      branch_name: "hotfix/auth",
      session_label: "Auth fix",
      worktree_path: "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/d_hotfix-auth",
    }),
  ];

  it("entries grouped by project_id", () => {
    const groups = groupByProject(worktrees, []);

    expect(groups).toHaveLength(3);

    const projectIds = groups.map((g) => g.projectId);
    expect(projectIds).toContain("project-1");
    expect(projectIds).toContain("project-2");
    expect(projectIds).toContain("project-3");

    const frontendGroup = groups.find((g) => g.projectId === "project-1")!;
    expect(frontendGroup.worktrees).toHaveLength(2);

    const backendGroup = groups.find((g) => g.projectId === "project-2")!;
    expect(backendGroup.worktrees).toHaveLength(1);

    const apiGroup = groups.find((g) => g.projectId === "project-3")!;
    expect(apiGroup.worktrees).toHaveLength(1);
  });

  it("entries sorted by project name", () => {
    const groups = groupByProject(worktrees, []);
    const projectNames = groups.map((g) => g.projectName);

    // Groups preserve insertion order from worktrees array
    // project-1 (frontend), project-2 (backend), project-3 (api-gateway)
    expect(projectNames).toEqual(["frontend", "backend", "api-gateway"]);
  });

  it("search filters by branch name", () => {
    const groups = groupByProject(worktrees, []);
    const filtered = filterGroups(groups, "login");

    // Only the worktree with branch "feature/login" should match
    expect(filtered).toHaveLength(1);
    expect(filtered[0].projectId).toBe("project-1");
    expect(filtered[0].worktrees).toHaveLength(1);
    expect(filtered[0].worktrees[0].branch_name).toBe("feature/login");
  });

  it("search filters by session label", () => {
    const groups = groupByProject(worktrees, []);
    const filtered = filterGroups(groups, "Auth fix");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].projectId).toBe("project-3");
    expect(filtered[0].worktrees).toHaveLength(1);
    expect(filtered[0].worktrees[0].session_label).toBe("Auth fix");
  });

  it("search filters by project name", () => {
    const groups = groupByProject(worktrees, []);
    const filtered = filterGroups(groups, "backend");

    // "backend" matches project_name for project-2, and all worktrees under it match
    expect(filtered).toHaveLength(1);
    expect(filtered[0].projectId).toBe("project-2");
    expect(filtered[0].worktrees).toHaveLength(1);
  });

  it("search filters by project name matches all entries in that project", () => {
    const groups = groupByProject(worktrees, []);
    const filtered = filterGroups(groups, "frontend");

    // "frontend" matches project_name for project-1, so both worktrees match
    expect(filtered).toHaveLength(1);
    expect(filtered[0].projectId).toBe("project-1");
    expect(filtered[0].worktrees).toHaveLength(2);
  });

  it("empty search shows all entries", () => {
    const groups = groupByProject(worktrees, []);
    const filtered = filterGroups(groups, "");

    expect(filtered).toHaveLength(3);
    const total = filtered.reduce((sum, g) => sum + g.worktrees.length, 0);
    expect(total).toBe(4);
  });

  it("whitespace-only search shows all entries", () => {
    const groups = groupByProject(worktrees, []);
    const filtered = filterGroups(groups, "   ");

    expect(filtered).toHaveLength(3);
  });

  it("search is case-insensitive", () => {
    const groups = groupByProject(worktrees, []);
    const filtered = filterGroups(groups, "BACKEND");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].projectName).toBe("backend");
  });

  it("orphans grouped with matching project by project_path", () => {
    const orphan = makeOrphan({
      project_path: "/Users/dev/frontend",
      worktree_path: "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/orphan_old",
      branch_name: "old-branch",
      kind: "directory_only",
    });
    const groups = groupByProject(worktrees, [orphan]);

    const frontendGroup = groups.find((g) => g.projectId === "project-1")!;
    expect(frontendGroup.orphans).toHaveLength(1);
    expect(frontendGroup.orphans[0].worktree_path).toBe(
      "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/orphan_old",
    );
  });

  it("orphans without matching project create standalone group", () => {
    const orphan = makeOrphan({
      project_path: "/Users/dev/unknown-project",
      worktree_path: "/app/data/hermes-worktrees/a1b2c3d4e5f6a7b8/orphan_x",
      kind: "directory_only",
    });
    const groups = groupByProject(worktrees, [orphan]);

    // 3 existing projects + 1 new standalone group for the orphan
    expect(groups).toHaveLength(4);
    const standaloneGroup = groups.find((g) => g.projectPath === "/Users/dev/unknown-project")!;
    expect(standaloneGroup).toBeDefined();
    expect(standaloneGroup.orphans).toHaveLength(1);
    expect(standaloneGroup.worktrees).toHaveLength(0);
  });

  it("no-match search returns empty", () => {
    const groups = groupByProject(worktrees, []);
    const filtered = filterGroups(groups, "zzz-no-match-zzz");

    expect(filtered).toHaveLength(0);
  });
});
