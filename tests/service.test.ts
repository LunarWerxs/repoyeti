import { test, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { getRepo, setRepoStatus, type RepoStatus } from "../src/db.ts";
import { enqueue } from "../src/opqueue.ts";
import {
  coalescedRefresh,
  getChanges,
  refreshQueueHealth,
  refreshRepo,
  registerRepo,
  watchOne,
  stopWatching,
  unwatchOne,
  watcherHealth,
  MAX_CHANGED_FILES,
} from "../src/service/index.ts";
import { mustUpsertRepo } from "./helpers/upsert.ts";
import { mkScratchDir } from "./helpers/scratch.ts";

const tmp = (): string => mkScratchDir("gm-svc-");

async function gitRepo(prefix = "gm-svc-repo-"): Promise<string> {
  const dir = mkScratchDir(prefix);
  await $`git -c init.defaultBranch=main init -q ${dir}`.quiet();
  await $`git -C ${dir} -c user.name=Seed -c user.email=s@s.io commit -q --allow-empty -m init`.quiet();
  return dir;
}

const status = (fetchedAt: number | null): RepoStatus => ({
  branch: "main",
  detached: false,
  dirty: 0,
  ahead: 0,
  behind: 1,
  remote: "origin",
  error: null,
  fetchedAt,
  updatedAt: Date.now(),
});

test("refreshRepo preserves fetchedAt on non-fetch refreshes", async () => {
  const dir = await gitRepo();
  const id = mustUpsertRepo(dir, "repo", "auto", false);
  setRepoStatus(id, status(12345));

  await refreshRepo(id, dir);

  expect(getRepo(id)?.status?.fetchedAt).toBe(12345);
});

test("getChanges waits behind the per-repo operation queue", async () => {
  const dir = await gitRepo();
  writeFileSync(join(dir, "x.txt"), "dirty");
  const id = mustUpsertRepo(dir, "repo-queued", "auto", false);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocker = enqueue(id, () => gate);

  let settled = false;
  const changes = getChanges(id).then((result) => {
    settled = true;
    return result;
  });
  await Bun.sleep(50);
  expect(settled).toBe(false);

  release();
  await blocker;
  const result = await changes;
  expect(result.ok).toBe(true);
  expect(result.files?.some((f) => f.path === "x.txt")).toBe(true);
});

test("manual registration preserves .git file actionability semantics", async () => {
  const root = tmp();
  const dir = join(root, "subm");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".git"), "gitdir: ../.git/modules/subm");

  const result = await registerRepo(dir);

  expect(result.ok).toBe(true);
  expect(result.repo?.isSubmodule).toBe(true);
});

test("explicit registration upgrades an auto-discovered repo source", async () => {
  const dir = await gitRepo("gm-svc-source-");
  const id = mustUpsertRepo(dir, "repo-source", "auto", false);

  const result = await registerRepo(dir);

  expect(result.ok).toBe(true);
  expect(result.repo?.id).toBe(id);
  expect(getRepo(id)?.source).toBe("pinned");
});

test("getChanges caps an oversized changed-file list and flags truncation", async () => {
  const dir = await gitRepo("gm-svc-cap-");
  const extra = 5;
  for (let i = 0; i < MAX_CHANGED_FILES + extra; i++) {
    writeFileSync(join(dir, `f${i}.txt`), "x"); // untracked → shows up in git status
  }
  const id = mustUpsertRepo(dir, "repo-cap", "auto", false);

  const result = await getChanges(id);

  expect(result.ok).toBe(true);
  expect(result.truncated).toBe(true);
  expect(result.total).toBe(MAX_CHANGED_FILES + extra);
  expect(result.files?.length).toBe(MAX_CHANGED_FILES);
});

test("background refresh scheduling bounds pending promise chains across repos", async () => {
  const bare = tmp();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const ids = Array.from({ length: 20 }, (_, index) => `refresh-bound-${index}`);
  const blockers = ids.map((id) => enqueue(id, () => gate));

  for (const id of ids) coalescedRefresh(id, bare);
  await Bun.sleep(20);

  expect(refreshQueueHealth()).toEqual({ active: 16, queued: 4 });
  release();
  await Promise.all(blockers);
  for (let i = 0; i < 300 && refreshQueueHealth().active + refreshQueueHealth().queued > 0; i++) {
    await Bun.sleep(10);
  }
  expect(refreshQueueHealth()).toEqual({ active: 0, queued: 0 });
  for (const id of ids) unwatchOne(id);
});

// NOTE: stopWatching() here clears the global watch registry, so this must stay LAST.
test("watchOne falls back to polling when the filesystem watch can't be installed", () => {
  stopWatching(); // clean slate — earlier tests registered live watchers via registerRepo
  const bare = mkScratchDir("gm-svc-nowatch-"); // no .git → watch unhealthy

  watchOne("poll-fallback", bare);

  const health = watcherHealth();
  expect(health.polling).toBe(1);
  expect(health.unhealthy).toContain("poll-fallback");

  stopWatching();
  expect(watcherHealth().polling).toBe(0);
});
