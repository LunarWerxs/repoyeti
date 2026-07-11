#!/usr/bin/env bun
/**
 * repoyeti bin entry — a thin shebang shim. All command logic lives in src/cli/
 * (main.ts dispatches; lifecycle.ts boots the daemon; git.ts/token.ts/mcp.ts drive
 * a running daemon). Kept at src/index.ts because that's the published `bin` target
 * and what the tray launcher invokes (`bun src/index.ts start`).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { main } from "./cli/main.ts";
import { initFileLogging } from "./log-file.mjs";

// Persist console output to <CONFIG_DIR>/logs/daemon.log BEFORE anything else can throw, so the
// crash reason logged just below actually survives the process (the tray runs us with a hidden
// console, so without this the output would vanish). Best-effort; never throws. log-file.mjs is
// the shared LunarWerx server-lib (synced from the kit); the config dir is resolved inline here
// (env override else ~/.repoyeti) so logging depends only on node builtins and runs before the
// config chain.
initFileLogging(process.env.REPOYETI_HOME ?? join(homedir(), ".repoyeti"));

// Last-resort crash handlers: an unhandled throw/rejection anywhere in the daemon logs what
// happened and exits non-zero instead of dying silently (or, for a rejection, limping on in an
// unknown state). A supervisor/launcher sees the non-zero exit and can restart (the tray's
// health watchdog does); the console.error above is now teed to daemon.log, so the reason is
// on disk even after the process is gone.
process.on("uncaughtException", (err) => {
  console.error("[repoyeti] uncaught exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[repoyeti] unhandled rejection:", reason);
  process.exit(1);
});

await main(process.argv.slice(2));
