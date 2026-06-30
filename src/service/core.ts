/**
 * Orchestration core: per-repo status refresh and the action runner that every mutating
 * VCS action funnels through (so a user-triggered fetch/pull/push can never race the
 * watcher's status read on the same repo). After any action we re-read and broadcast
 * status so the phone sees the result over SSE without polling.
 */
import { enqueue } from "../opqueue.ts";
import { diffStatsEnabled } from "../read/diffstat.ts";
import { broadcast } from "../bus.ts";
import { getRepo, setRepoStatus, setRepoOrder } from "../db.ts";
import { resolveRepoIdentity } from "../identity.ts";
import { backendFor } from "../vcs/index.ts";
import type { VcsBackend } from "../vcs/types.ts";
import type { ActionResult } from "../git-actions.ts";
import type { Identity, RepoView } from "../db.ts";

/** Per-repo last-status signature (sans timestamp) so a no-op read doesn't emit. */
export const lastStatusSig = new Map<string, string>();

/** Read a repo's status behind its op-queue; persist + push over SSE only on change. */
export async function refreshRepo(id: string, absPath: string, markFetched = false): Promise<void> {
  const previous = getRepo(id)?.status;
  const backend = backendFor(getRepo(id)?.vcs ?? "git");
  const status = await enqueue(id, () => backend.readStatus(absPath, diffStatsEnabled()));
  if (markFetched) status.fetchedAt = Date.now();
  else status.fetchedAt = previous?.fetchedAt ?? null;
  const { updatedAt: _omit, ...sig } = status;
  const signature = JSON.stringify(sig);
  if (lastStatusSig.get(id) === signature) return;
  lastStatusSig.set(id, signature);
  setRepoStatus(id, status);
  broadcast("repo_state_changed", { id, status });
}

export interface ActionOutcome extends ActionResult {
  repoId: string;
}

type VcsAction = (backend: VcsBackend, absPath: string, identity: Identity | null) => Promise<ActionResult>;

export async function runAction(repoId: string, action: VcsAction, markFetched = false): Promise<ActionOutcome> {
  const repo = getRepo(repoId);
  if (!repo) return { ok: false, code: "NOT_FOUND", message: "repo not found", repoId };
  if (repo.isSubmodule) {
    return { ok: false, code: "SUBMODULE_NOT_ACTIONABLE", message: "submodule worktree is not actionable", repoId };
  }
  const identity = resolveRepoIdentity(repo);
  const backend = backendFor(repo.vcs);
  const result = await enqueue(repoId, () => action(backend, repo.absPath, identity));
  // Reflect the new reality (ahead/behind/dirty) to all clients.
  await refreshRepo(repoId, repo.absPath, markFetched && result.ok);
  return { ...result, repoId };
}

/**
 * Force a fresh status read (the phone's "pull to refresh"). Catches working-tree
 * edits the `.git`-only watcher intentionally doesn't see. Returns the latest view.
 */
export async function forceRefresh(repoId: string): Promise<RepoView | null> {
  const repo = getRepo(repoId);
  if (!repo) return null;
  await refreshRepo(repo.id, repo.absPath);
  return getRepo(repo.id);
}

/** Persist the user's drag-to-reorder of the repo list (order = repo ids top→bottom). */
export function reorderRepos(orderedIds: string[]): void {
  setRepoOrder(orderedIds);
}
