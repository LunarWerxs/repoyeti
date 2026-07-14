/**
 * Safe remote git actions — fetch / pull / push — with the non-negotiable guards:
 *  - The daemon NEVER leaves a repo half-merged. Pull is fast-forward-only: it runs even on a
 *    dirty tree (git aborts atomically as WOULD_OVERWRITE if your edits would be overwritten,
 *    otherwise the fast-forward preserves them) and is refused only on a detached HEAD.
 *  - Push is never `--force`. A non-fast-forward push is reported, not forced.
 *  - Every failure maps to a stable, first-class error code the UI can render.
 *
 * Auth + author identity are injected per operation (`-c core.sshCommand` + `-c user.*`)
 * via git.ts — global/repo config is never mutated.
 *
 * Implementation now lives in ./git-actions/ (split by concern: sync/commit/diff/refs — see
 * that folder's index.ts for the breakdown). This file is kept as a thin re-export shim so
 * every existing `from "./git-actions.ts"` / `from "../git-actions.ts"` import (this repo uses
 * explicit `.ts`-suffixed specifiers under `moduleResolution: "bundler"`, which does NOT fall
 * back from a flat-file specifier to a same-named folder's index.ts) keeps resolving unchanged.
 */
export * from "./git-actions/index.ts";
