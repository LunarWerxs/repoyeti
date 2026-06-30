/**
 * Mutating VCS actions, each funnelled through `runAction` (core.ts) so it goes behind the
 * per-repo op-queue and re-broadcasts status afterward. Plus the bulk fetch-all helper.
 */
import { getWatchableRepos } from "../db.ts";
import { enqueue } from "../opqueue.ts";
import { resolveRepoIdentity } from "../identity.ts";
import { backendFor } from "../vcs/index.ts";
import {
  gitRemoteSet,
  gitRemoteRemove,
  gitTagCreate,
  type ActionCode,
  type CommitGroupSpec,
  type CommitGroupResult,
} from "../git-actions.ts";
import { runAction, refreshRepo, type ActionOutcome } from "./core.ts";
import { guardRepo } from "./guards.ts";
import { resolveRepoPath } from "./files.ts";

export const fetchRepo = (id: string): Promise<ActionOutcome> => runAction(id, (b, p, idn) => b.fetch(p, idn), true);
export const pullRepo = (id: string): Promise<ActionOutcome> => runAction(id, (b, p, idn) => b.pull(p, idn), true);
export const pushRepo = (id: string): Promise<ActionOutcome> => runAction(id, (b, p, idn) => b.push(p, idn));
export const commitRepo = (
  id: string,
  message: string,
  amend = false,
): Promise<ActionOutcome> =>
  runAction(id, (b, p, idn) => b.commitAll(p, idn, message, amend));

// ── branch actions (switch / create / delete) ─────────────────────────────────────
export const checkoutRepo = (id: string, branch: string): Promise<ActionOutcome> =>
  runAction(id, (b, p) => b.checkout(p, branch));
export const createBranchRepo = (id: string, name: string, switchTo = true): Promise<ActionOutcome> =>
  runAction(id, (b, p) => b.createBranch(p, name, switchTo));
export const deleteBranchRepo = (id: string, name: string): Promise<ActionOutcome> =>
  runAction(id, (b, p) => b.deleteBranch(p, name));

// ── stash actions (save / pop / drop) ─────────────────────────────────────────────
export const stashSaveRepo = (id: string, message?: string): Promise<ActionOutcome> =>
  runAction(id, (b, p, idn) => b.stashSave(p, idn, message));
export const stashPopRepo = (id: string, index = 0): Promise<ActionOutcome> =>
  runAction(id, (b, p) => b.stashPop(p, index));
export const stashDropRepo = (id: string, index = 0): Promise<ActionOutcome> =>
  runAction(id, (b, p) => b.stashDrop(p, index));

// ── remote actions (set-url / remove origin) ──────────────────────────────────────
// Local `.git/config` edits (no network). runAction refreshes status after, so the card's
// remote URL + the cloud icon update over SSE immediately.
export const setRemoteRepo = (id: string, name: string, url: string): Promise<ActionOutcome> =>
  runAction(id, (_b, p) => gitRemoteSet(p, name, url));
export const removeRemoteRepo = (id: string, name: string): Promise<ActionOutcome> =>
  runAction(id, (_b, p) => gitRemoteRemove(p, name));

// ── tag creation (git-only; the route guards on repo.vcs) ──────────────────────────
export const createTagRepo = (
  id: string,
  name: string,
  message?: string,
  push = false,
): Promise<ActionOutcome> =>
  runAction(id, (_b, p, idn) => gitTagCreate(p, idn, name, message, push));

// ── bulk fetch-all ────────────────────────────────────────────────────────────────
export interface FetchAllResult {
  /** Repos that had a remote and were attempted. */
  total: number;
  /** How many fetched cleanly. */
  ok: number;
  /** Per-repo failures (so the UI can name them). */
  failed: Array<{ id: string; name: string; code: string }>;
}

/**
 * Fetch every repo that has a remote. Each goes through `fetchRepo` → the per-repo op-queue
 * and the network gate (`netGate`, default 4 concurrent), so firing them all at once stays
 * bounded — no new concurrency logic needed. Repos with no remote are skipped (not failures).
 */
export async function fetchAllRepos(): Promise<FetchAllResult> {
  const repos = getWatchableRepos().filter((r) => r.status?.remote);
  const results = await Promise.allSettled(repos.map((r) => fetchRepo(r.id)));
  const failed: FetchAllResult["failed"] = [];
  let ok = 0;
  results.forEach((res, i) => {
    if (res.status === "fulfilled" && res.value.ok) ok++;
    else {
      const code = res.status === "fulfilled" ? res.value.code : "ERROR";
      failed.push({ id: repos[i]!.id, name: repos[i]!.name, code });
    }
  });
  return { total: repos.length, ok, failed };
}

/** Result of discarding one file's working-tree changes (the changes-tree "Discard" action). */
export interface DiscardResult {
  ok: boolean;
  code: "OK" | "NOT_FOUND" | "ERROR" | "DISCARD_FAILED" | "SUBMODULE_NOT_ACTIONABLE";
  message?: string;
  /** Repo-relative path that was discarded (normalised to forward slashes). */
  path?: string;
}

/**
 * Discard one changed file's working-tree changes — the inverse of the file editor.
 * Untrusted-path safe (confined to the repo exactly like readFileContent), behind the
 * per-repo op-queue, and DESTRUCTIVE — the UI gates it behind an explicit confirm.
 *
 * Three cases, all "restore this file to its committed/absent state":
 *  - tracked in HEAD (modified or deleted) → `git checkout HEAD -- <path>` restores it.
 *  - added/untracked (not in HEAD)         → remove the working file + unstage any add.
 * HEAD is never touched and no merge state is possible, so the safety invariant holds.
 */
export async function discardFile(repoId: string, relPath: string): Promise<DiscardResult> {
  const g = guardRepo<"SUBMODULE_NOT_ACTIONABLE">(repoId, "SUBMODULE_NOT_ACTIONABLE");
  if (g.fail) return g.fail;
  const repo = g.repo;
  const r = resolveRepoPath(repo.absPath, relPath);
  if ("error" in r) return { ok: false, code: "ERROR", message: r.error };
  const backend = backendFor(repo.vcs);
  // Never reach into the VCS marker dir (.git / .lore) — restoring its internals is nonsense/unsafe.
  if (r.clean.split("/").includes(backend.marker)) {
    return { ok: false, code: "ERROR", message: `refusing to touch a ${backend.marker} directory` };
  }
  const result = await enqueue(repoId, () => backend.discardFile(repo.absPath, r.clean));
  // Refresh AFTER the queue slot releases (refreshRepo enqueues again → would deadlock if nested).
  if (result.ok) {
    await refreshRepo(repo.id, repo.absPath);
    return { ok: true, code: "OK", path: r.clean };
  }
  return { ok: false, code: result.code === "ERROR" ? "ERROR" : "DISCARD_FAILED", message: result.message };
}

// ── smart commit (AI multi-commit splitter) ─────────────────────────────────────────

export interface SmartCommitOutcome {
  ok: boolean;
  code: ActionCode;
  message: string;
  repoId: string;
  /** Per-group outcome, in order (present once execution started). */
  committed?: CommitGroupResult[];
  /** Groups not attempted because an earlier one failed. */
  remaining?: number;
  /** True when a requested post-commit push succeeded. */
  synced?: boolean;
  /** The sync (pull/push) code/message when sync was requested and didn't fully succeed. */
  syncCode?: ActionCode;
  syncMessage?: string;
}

/**
 * Execute an owner-edited commit plan: validate the submitted groups against the LIVE working
 * tree, then run the whole stage+commit sequence inside ONE op-queue slot (so nothing can
 * interleave), optionally syncing afterward, and refresh once the slot releases.
 *
 * Validation (against fresh `readChanges`):
 *  - every submitted path must currently be changed (a vanished/stale path → PLAN_STALE);
 *  - no path may appear in two groups (→ PLAN_PATHS_INVALID).
 * A rename's old path is auto-added to its group so the deletion lands with the addition.
 * Leaving some changed files unassigned is allowed — they simply stay in the working tree.
 */
export async function smartCommitRepo(
  repoId: string,
  commits: Array<{ message: string; paths: string[] }>,
  sync = false,
): Promise<SmartCommitOutcome> {
  const g = guardRepo<"SUBMODULE_NOT_ACTIONABLE", { repoId: string }>(repoId, "SUBMODULE_NOT_ACTIONABLE", { repoId });
  if (g.fail) return g.fail;
  const repo = g.repo;
  if (commits.length === 0) return { ok: false, code: "EMPTY_PLAN", message: "no commits in the plan", repoId };
  const identity = resolveRepoIdentity(repo);
  const backend = backendFor(repo.vcs);

  const outcome = await enqueue(repoId, async (): Promise<Omit<SmartCommitOutcome, "repoId">> => {
    // Validate against the CURRENT tree (the plan may have been built minutes ago).
    const fresh = await backend.readChanges(repo.absPath, false);
    const changedSet = new Set(fresh.map((f) => f.path));
    const renameFrom = new Map<string, string>();
    for (const f of fresh) if (f.from) renameFrom.set(f.path, f.from);

    const seen = new Set<string>();
    const specs: CommitGroupSpec[] = [];
    for (const c of commits) {
      const expanded: string[] = [];
      for (const raw of c.paths) {
        const p = raw.replace(/\\/g, "/").trim();
        if (!changedSet.has(p)) {
          return { ok: false, code: "PLAN_STALE", message: `"${p}" is no longer a pending change — re-plan` };
        }
        if (seen.has(p)) {
          return { ok: false, code: "PLAN_PATHS_INVALID", message: `"${p}" is assigned to more than one commit` };
        }
        seen.add(p);
        expanded.push(p);
        const from = renameFrom.get(p);
        if (from) expanded.push(from); // stage the rename's old path with the new one
      }
      specs.push({ message: c.message, paths: expanded });
    }

    const res = await backend.commitGroups(repo.absPath, identity, specs);
    const base: Omit<SmartCommitOutcome, "repoId"> = {
      ok: res.ok,
      code: res.code,
      message: res.message,
      committed: res.committed,
      remaining: res.remaining,
    };
    if (!res.ok || !sync) return base;

    // Post-commit sync (mirrors the UI's "commit & sync"): pull --ff-only, then push.
    const pull = await backend.pull(repo.absPath, identity);
    const push = await backend.push(repo.absPath, identity);
    if (push.ok) return { ...base, synced: true };
    return { ...base, synced: false, syncCode: push.code, syncMessage: push.message || pull.message };
  });

  // Refresh AFTER the slot releases (refreshRepo enqueues again → nesting would deadlock).
  await refreshRepo(repo.id, repo.absPath, outcome.ok && outcome.synced === true);
  return { ...outcome, repoId };
}
