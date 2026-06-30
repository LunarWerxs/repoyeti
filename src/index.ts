#!/usr/bin/env bun
/**
 * repoyeti bin entry — a thin shebang shim. All command logic lives in src/cli/
 * (main.ts dispatches; lifecycle.ts boots the daemon; git.ts/token.ts/mcp.ts drive
 * a running daemon). Kept at src/index.ts because that's the published `bin` target
 * and what the tray launcher invokes (`bun src/index.ts start`).
 */
import { main } from "./cli/main.ts";

await main(process.argv.slice(2));
