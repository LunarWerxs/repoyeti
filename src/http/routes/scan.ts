import type { Hono } from "hono";
import type { Deps } from "../deps.ts";
import { rescanAll, cancelScan, isScanning } from "../../service/index.ts";

export function register(app: Hono, { cfg }: Deps): void {
  // ── on-demand project scan (rescan every configured root; cancellable) ────────────
  // Fire-and-forget: repos + progress stream in over SSE (scan_started → scan_progress /
  // repo_added → scan_done | scan_cancelled). A second start while one runs is a no-op —
  // the running scan keeps going and `running: true` is returned either way.
  app.post("/api/scan", (c) => {
    if (!isScanning()) void rescanAll(cfg).catch(() => {});
    return c.json({ ok: true, running: true });
  });
  // Stop the in-flight scan (the modal's X). Repos found so far stay indexed.
  app.post("/api/scan/cancel", (c) => c.json({ ok: true, cancelled: cancelScan() }));
}
