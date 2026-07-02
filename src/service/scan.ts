/**
 * On-demand "Scan for projects": rescan every configured scan root for repositories,
 * cancellable and progress-reporting over SSE. Mirrors boot discovery (`runDiscovery` in
 * cli/lifecycle.ts) — index → watch → status-read each repo as it's found — but is driven by
 * the dashboard's Scan modal rather than daemon startup, and reports its lifecycle so the
 * modal can show a live "found N" status with a Stop (X) control.
 *
 * Only ONE scan runs at a time (a second start while one is in flight is a no-op). Repos
 * already known before the scan started are NOT re-announced as "new" — `added` counts only
 * genuinely-new repositories, which drives the "N new projects found" notification.
 */
import type { RepoYetiConfig } from "../config.ts";
import { broadcast } from "../bus.ts";
import { getRepo, getRepos, upsertRepo } from "../db.ts";
import { discoverStream } from "../discovery.ts";
import { refreshRepo } from "./core.ts";
import { watchOne } from "./watch.ts";

// The in-flight scan's abort controller, or null when idle. Guards single-flight + cancel.
let active: AbortController | null = null;

/** Whether a scan is currently running. */
export function isScanning(): boolean {
  return active !== null;
}

/** Abort the in-flight scan, if any. Returns whether a scan was actually running. */
export function cancelScan(): boolean {
  if (!active) return false;
  active.abort();
  return true;
}

/** How often (in repos found) to emit a progress heartbeat, so a huge tree can't flood SSE. */
const PROGRESS_EVERY = 10;

export interface ScanSummary {
  found: number;
  added: number;
  cancelled: boolean;
}

/**
 * Rescan all configured roots. Fire-and-forget from the route: repos stream in live via
 * `repo_added` (new ones only), progress via `scan_progress`, and the run ends with
 * `scan_done` or `scan_cancelled`. A no-op returning a zeroed summary if a scan is already
 * running (single-flight — the running scan keeps going).
 */
export async function rescanAll(cfg: RepoYetiConfig): Promise<ScanSummary> {
  if (active) return { found: 0, added: 0, cancelled: false };
  const controller = new AbortController();
  active = controller;

  // Snapshot what we already knew, so we only announce/count genuinely-new repos (mirrors the
  // boot-discovery new-vs-known check in cli/lifecycle.ts).
  const knownIds = new Set(getRepos().map((r) => r.id));
  let found = 0;
  let added = 0;

  broadcast("scan_started", { roots: cfg.roots.length });
  try {
    await discoverStream(
      cfg.roots,
      cfg.maxDepth,
      cfg.maxRepos,
      (f) => {
        // Same index → watch → refresh sequence as boot/add-root discovery. `watchOne` and
        // `upsertRepo` are idempotent, so re-scanning an already-known repo just refreshes it.
        const id = upsertRepo(f.absPath, f.name, "auto", f.isSubmodule, f.vcs);
        watchOne(id, f.absPath);
        void refreshRepo(id, f.absPath).catch(() => {});
        found++;
        if (!knownIds.has(id)) {
          const repo = getRepo(id);
          if (repo) {
            added++;
            broadcast("repo_added", { repo });
          }
        }
        if (found % PROGRESS_EVERY === 0) broadcast("scan_progress", { found, added });
      },
      controller.signal,
    );
  } finally {
    active = null;
  }

  const cancelled = controller.signal.aborted;
  broadcast(cancelled ? "scan_cancelled" : "scan_done", { found, added, cancelled });
  return { found, added, cancelled };
}
