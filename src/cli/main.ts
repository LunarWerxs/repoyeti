/**
 * repoyeti CLI dispatcher. `repoyeti <command> [args]`.
 *
 * Daemon-lifecycle commands (start/add-root/status) live in ./lifecycle.ts. Git/agent verbs
 * that drive a running daemon over its local HTTP API (commit/log/branch/…, mcp, token) are
 * added in ./git.ts, ./token.ts, ./mcp.ts and wired into the switch below. `start` is the
 * implicit default so a bare `repoyeti` boots the daemon, preserving the original behavior.
 */
import { VERSION } from "../config.ts";
import { start, addRootCmd, statusCmd } from "./lifecycle.ts";

export async function main(argv: string[]): Promise<void> {
  const cmd = argv[0] ?? "start";

  switch (cmd) {
    case "start":
      await start(argv.slice(1));
      break;
    case "add-root":
      addRootCmd(argv[1]);
      break;
    case "status":
      statusCmd();
      break;
    case "-h":
    case "--help":
    case "help":
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`repoyeti ${VERSION}

Usage:
  repoyeti start [--root <path>] [--port <n>] [--tunnel]   Boot the daemon
  repoyeti add-root <path>                                  Register a directory to scan
  repoyeti status                                           Show config + discovered repos
`);
}
