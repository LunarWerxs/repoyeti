#!/usr/bin/env bun
/**
 * Drift guard: the `ApiErrorCode` union is hand-mirrored in two places —
 *   - src/contract.ts        (the daemon's single source of truth + HTTP-status map)
 *   - web/src/types.ts       (the web app's copy, so the UI can switch on codes)
 * They MUST stay identical. This script extracts both unions and fails (exit 1) on any
 * divergence, so adding a backend code without the frontend copy becomes a CI error
 * instead of a runtime surprise. Run: `bun run check:codes` (wired into CI).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

function extractApiErrorCodes(relFile: string): Set<string> {
  const src = readFileSync(join(ROOT, relFile), "utf8");
  // Capture the union body up to the terminating `;` (non-greedy → stops at the first one).
  const m = src.match(/export type ApiErrorCode\s*=([\s\S]*?);/);
  if (!m) throw new Error(`ApiErrorCode union not found in ${relFile}`);
  const codes = new Set<string>();
  for (const lit of m[1]!.matchAll(/"([A-Z0-9_]+)"/g)) codes.add(lit[1]!);
  return codes;
}

const backend = extractApiErrorCodes("src/contract.ts");
const frontend = extractApiErrorCodes("web/src/types.ts");

const onlyBackend = [...backend].filter((c) => !frontend.has(c));
const onlyFrontend = [...frontend].filter((c) => !backend.has(c));

if (onlyBackend.length || onlyFrontend.length) {
  console.error("✗ ApiErrorCode drift between src/contract.ts and web/src/types.ts:");
  if (onlyBackend.length) console.error(`  backend-only (add to web/src/types.ts): ${onlyBackend.join(", ")}`);
  if (onlyFrontend.length) console.error(`  web-only (add to src/contract.ts):     ${onlyFrontend.join(", ")}`);
  process.exit(1);
}

console.log(`✓ ApiErrorCode in sync (${backend.size} codes) across src/contract.ts + web/src/types.ts`);
