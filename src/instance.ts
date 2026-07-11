/**
 * Running-instance pointer — thin per-app adapter over the shared kit factory
 * (`createInstancePointer`, synced in as `./instance-pointer.mjs`). The only local
 * code is RepoYeti's config-dir resolution (which honours REPOYETI_HOME via
 * CONFIG_DIR) plus its service/host identity. The daemon records the port it
 * ACTUALLY bound in `<CONFIG_DIR>/runtime.json` so launchers and the /api/health
 * probe can find it and enforce single-instance. Best-effort throughout.
 */
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "./config.ts";
import { createInstancePointer, type InstanceInfo } from "./instance-pointer.mjs";

export type { InstanceInfo };

const pointer = createInstancePointer({
  configDir: CONFIG_DIR,
  serviceName: "repoyeti",
  host: "127.0.0.1",
});

export const instanceFilePath = pointer.instanceFilePath;
export const writeInstanceInfo = pointer.writeInstanceInfo;
export const updateInstanceInfo = pointer.updateInstanceInfo;
export const readInstanceInfo = pointer.readInstanceInfo;
export const clearInstanceInfo = pointer.clearInstanceInfo;
export const findLiveInstance = pointer.findLiveInstance;

// ---------------------------------------------------------------------------
// "Full shutdown requested" sentinel — a marker file the PowerShell tray host polls so a
// user "Shut Down" from the web UI tears down the WHOLE app, notification-area icon included,
// not just the daemon. It lives beside runtime.json in CONFIG_DIR. The tray stops the daemon by
// port (Stop-RepoYeti) and never calls POST /api/shutdown, so any request that reaches that
// route IS a user shutdown and drops this — which also tells the tray's auto-restart watchdog to
// stand down instead of resurrecting the daemon. Cleared on daemon boot and by the tray at
// startup so a stale one never causes a spurious quit. Best-effort throughout.
// ---------------------------------------------------------------------------
const SHUTDOWN_REQUEST_FILE = join(CONFIG_DIR, "shutdown.request");
export function writeShutdownRequest(): void {
  try {
    writeFileSync(SHUTDOWN_REQUEST_FILE, JSON.stringify({ ts: Date.now() }), { mode: 0o600 });
  } catch {
    /* best-effort */
  }
}
export function clearShutdownRequest(): void {
  try {
    rmSync(SHUTDOWN_REQUEST_FILE, { force: true });
  } catch {
    /* best-effort */
  }
}
