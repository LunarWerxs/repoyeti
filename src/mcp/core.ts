/**
 * Thin adapter binding RepoYeti's MCP tool catalog + a backend to the SHARED stdio engine
 * (./mcp-stdio.mjs — synced from the lunarwerx-ui kit; edit it there, never the synced copy). The
 * JSON-RPC 2.0 / MCP dispatch now lives in the engine; this file only preserves RepoYeti's
 * (msg, backend) API so the same catalog can serve BOTH transports — the stdio server binds
 * `httpBackend`, the in-process POST /api/mcp binds `serviceBackend` — each injecting its backend
 * here at dispatch time.
 *
 * Boundary: imports ONLY the engine, ./tools.ts, ./backend.ts, and ../config.ts (VERSION). It MUST
 * NOT import service/read/db/git-actions/vcs — the backend is injected (the guard still holds).
 */
import { VERSION } from "../config.ts";
import { handleRpc as engineHandleRpc, parseErrorResponse as engineParseError } from "./mcp-stdio.mjs";
import type { McpServerContext, McpEngineTool } from "./mcp-stdio.mjs";
import type { McpBackend } from "./backend.ts";
import { TOOLS } from "./tools.ts";

const SERVER_INFO = { name: "repoyeti", version: VERSION };

/**
 * Build the engine dispatch context for a backend: bind it into every tool so each matches the
 * engine's backend-agnostic `run(args)` contract. Exported so stdio.ts reuses the same binding.
 */
export function contextFor(backend: McpBackend): McpServerContext {
  const tools: McpEngineTool[] = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    run: (args) => t.run(backend, args),
  }));
  return { serverInfo: SERVER_INFO, tools };
}

/** Dispatch one JSON-RPC message against a backend — the (msg, backend) API the route + tests use. */
export function handleRpc(msg: unknown, backend: McpBackend): Promise<object | null> {
  return engineHandleRpc(msg, contextFor(backend));
}

/** A -32700 parse-error response (id null) — used by transports on malformed input. */
export function parseErrorResponse(): object {
  return engineParseError();
}
