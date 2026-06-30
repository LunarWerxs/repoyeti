import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { createApp } from "../src/http/app.ts";
import { upsertRepo } from "../src/db.ts";
import { stopWatching } from "../src/service/index.ts";
import type { RepoYetiConfig } from "../src/config.ts";

// Per-file (selected) staging for a single ordinary commit: stage + commit ONLY the chosen paths,
// leaving everything else pending. Reuses the same commitGroups primitive as Smart Commit, so this
// focuses on the route + service contract (subset commit, NO_MESSAGE, stale selection).

const localCfg = (): RepoYetiConfig => ({ roots: [], port: 7171, maxDepth: 6, maxRepos: 200 });
const J = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** A git repo with one seed commit + a configured local author (so null-identity commits work). */
async function seededRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "gm-sel-"));
  await $`git -c init.defaultBranch=main init -q ${dir}`.quiet();
  await $`git -C ${dir} config user.name Seed`.quiet();
  await $`git -C ${dir} config user.email s@s.io`.quiet();
  writeFileSync(join(dir, "a.txt"), "a0\n");
  await $`git -C ${dir} add -A`.quiet();
  await $`git -C ${dir} commit -q -m init`.quiet();
  return dir;
}
async function logSubjects(dir: string): Promise<string[]> {
  return (await $`git -C ${dir} log --pretty=format:%s`.text()).split("\n").filter(Boolean);
}
async function porcelain(dir: string): Promise<string[]> {
  const out = (await $`git -C ${dir} status --porcelain`.text()).trim();
  return out ? out.split("\n") : [];
}
function rmrf(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows watcher-handle race — best-effort cleanup, the OS temp dir is reclaimed anyway */
  }
}

test("POST /api/repos/:id/commit-selected commits only the chosen files; the rest stay pending", async () => {
  const dir = await seededRepo();
  try {
    // Two pending changes: modify a.txt (tracked) and add c.txt (untracked).
    writeFileSync(join(dir, "a.txt"), "a1\n");
    writeFileSync(join(dir, "c.txt"), "c0\n");
    const id = upsertRepo(dir, "sel", "auto", false);

    const res = await createApp(localCfg()).request(
      `/api/repos/${id}/commit-selected`,
      J({ message: "feat: just a", paths: ["a.txt"] }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // a.txt landed in a commit…
    expect(await logSubjects(dir)).toContain("feat: just a");
    // …and c.txt is still pending; a.txt no longer is.
    const status = await porcelain(dir);
    expect(status.some((l) => l.includes("c.txt"))).toBe(true);
    expect(status.some((l) => l.includes("a.txt"))).toBe(false);
  } finally {
    stopWatching();
    rmrf(dir);
  }
});

test("commit-selected requires a non-empty message (NO_MESSAGE, 400)", async () => {
  const dir = await seededRepo();
  try {
    writeFileSync(join(dir, "a.txt"), "a1\n");
    const id = upsertRepo(dir, "sel-nomsg", "auto", false);
    const res = await createApp(localCfg()).request(
      `/api/repos/${id}/commit-selected`,
      J({ message: "   ", paths: ["a.txt"] }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("NO_MESSAGE");
  } finally {
    stopWatching();
    rmrf(dir);
  }
});

test("commit-selected rejects a path that is no longer pending (PLAN_STALE, 409)", async () => {
  const dir = await seededRepo();
  try {
    writeFileSync(join(dir, "a.txt"), "a1\n");
    const id = upsertRepo(dir, "sel-stale", "auto", false);
    const res = await createApp(localCfg()).request(
      `/api/repos/${id}/commit-selected`,
      J({ message: "feat: x", paths: ["ghost.txt"] }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("PLAN_STALE");
  } finally {
    stopWatching();
    rmrf(dir);
  }
});
