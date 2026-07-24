import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { $ } from "bun";
import { readStatus } from "../src/read/status.ts";
import { currentGitOperation } from "../src/git.ts";

async function gitRepo(prefix = "gm-status-"): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  await $`git -c init.defaultBranch=main init -q ${dir}`.quiet();
  await $`git -C ${dir} -c user.name=Seed -c user.email=s@s.io commit -q --allow-empty -m init`.quiet();
  return dir;
}

test("readStatus resolves the origin remote URL", async () => {
  const dir = await gitRepo();
  await $`git -C ${dir} remote add origin https://example.com/a.git`.quiet();

  const s = await readStatus(dir);

  expect(s.remote).toContain("example.com/a.git");
  expect(s.error).toBeNull();
});

test("readStatus re-resolves the remote after .git/config changes (cache invalidation)", async () => {
  const dir = await gitRepo("gm-status-cache-");
  await $`git -C ${dir} remote add origin https://example.com/a.git`.quiet();

  const s1 = await readStatus(dir); // caches the remote keyed on .git/config mtime+size
  expect(s1.remote).toContain("example.com/a.git");

  // A different-length URL changes config's size → cache key changes even when the
  // filesystem's mtime granularity is coarse, so this asserts invalidation, not luck.
  await $`git -C ${dir} remote set-url origin https://example.com/a-much-longer-remote-name.git`.quiet();

  const s2 = await readStatus(dir);
  expect(s2.remote).toContain("a-much-longer-remote-name.git");
});

test("readStatus reports operation markers from an ordinary .git directory", async () => {
  const dir = await gitRepo("gm-status-operation-");
  writeFileSync(join(dir, ".git", "MERGE_HEAD"), "0123456789012345678901234567890123456789\n");

  const status = await readStatus(dir);

  expect(status.error).toBeNull();
  expect(status.gitOperation).toBe("MERGE_HEAD");
});

test("currentGitOperation follows a linked worktree's .git pointer without a Git lookup", async () => {
  const main = await gitRepo("gm-status-main-");
  const worktree = mkdtempSync(join(tmpdir(), "gm-status-worktree-parent-"));
  const checkout = join(worktree, "checkout");
  await $`git -C ${main} worktree add -q -b operation-test ${checkout}`.quiet();
  const rawGitDir = (
    await $`git -C ${checkout} rev-parse --git-dir`.quiet()
  ).stdout.toString().trim();
  const gitDir = isAbsolute(rawGitDir) ? rawGitDir : resolve(checkout, rawGitDir);
  mkdirSync(join(gitDir, "rebase-merge"));

  expect(await currentGitOperation(checkout)).toBe("rebase-merge");
});
