/**
 * addToGitignore (src/service/actions.ts) — the changes-tree "Add to .gitignore" action.
 * Covers: appends an anchored pattern, is idempotent (already-ignored → no-op), confines the path
 * to the repo, and preserves any existing .gitignore content.
 */
import { test, expect } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { addToGitignore } from "../src/service/index.ts";
import { mustUpsertRepo } from "./helpers/upsert.ts";
import { mkScratchDir } from "./helpers/scratch.ts";

async function gitRepo(name: string): Promise<{ dir: string; id: string }> {
  const dir = mkScratchDir(`gm-gitignore-${name}-`);
  await $`git -c init.defaultBranch=main init -q ${dir}`.quiet();
  await $`git -C ${dir} config user.name Seed`.quiet();
  await $`git -C ${dir} config user.email s@s.io`.quiet();
  writeFileSync(join(dir, "a.txt"), "a0\n");
  await $`git -C ${dir} add -A`.quiet();
  await $`git -C ${dir} commit -q -m init`.quiet();
  return { dir, id: mustUpsertRepo(dir, name, "auto", false) };
}

test("addToGitignore appends an anchored pattern and is idempotent", async () => {
  const { dir, id } = await gitRepo("append");
  const gi = join(dir, ".gitignore");

  const r1 = await addToGitignore(id, "build/output.log");
  expect(r1.ok).toBe(true);
  expect(r1.code).toBe("OK");
  expect(r1.pattern).toBe("/build/output.log");
  expect(r1.alreadyIgnored).toBe(false);
  expect(readFileSync(gi, "utf8")).toBe("/build/output.log\n");

  // Adding the same path again is a no-op (alreadyIgnored), not a duplicate line.
  const r2 = await addToGitignore(id, "build/output.log");
  expect(r2.ok).toBe(true);
  expect(r2.alreadyIgnored).toBe(true);
  expect(readFileSync(gi, "utf8")).toBe("/build/output.log\n");
});

test("addToGitignore preserves existing content and guarantees a separating newline", async () => {
  const { dir, id } = await gitRepo("preserve");
  const gi = join(dir, ".gitignore");
  writeFileSync(gi, "node_modules\n*.tmp"); // no trailing newline on the last line

  const r = await addToGitignore(id, "secret.env");
  expect(r.ok).toBe(true);
  expect(readFileSync(gi, "utf8")).toBe("node_modules\n*.tmp\n/secret.env\n");
});

test("addToGitignore refuses a path that escapes the repo", async () => {
  const { id } = await gitRepo("escape");
  const r = await addToGitignore(id, "../../etc/passwd");
  expect(r.ok).toBe(false);
  expect(r.code).toBe("ERROR");
});

test("addToGitignore treats a bare existing entry as already-ignored", async () => {
  const { dir, id } = await gitRepo("bare");
  const gi = join(dir, ".gitignore");
  writeFileSync(gi, "dist\n"); // bare (un-anchored) entry

  const r = await addToGitignore(id, "dist");
  expect(r.ok).toBe(true);
  expect(r.alreadyIgnored).toBe(true);
  expect(existsSync(gi)).toBe(true);
  expect(readFileSync(gi, "utf8")).toBe("dist\n"); // unchanged — no duplicate
});
