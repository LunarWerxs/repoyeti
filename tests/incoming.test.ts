import { test, expect } from "bun:test";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { readIncoming } from "../src/read/incoming.ts";
import { mkScratchDir } from "./helpers/scratch.ts";

// The pre-pull preview must be able to describe a pull WITHOUT performing one. These tests pin
// both halves of that: the description is correct, and the working tree is provably untouched
// afterwards (the whole safety claim of the feature).

interface Fixture {
  /** The local clone doing the previewing. */
  work: string;
  /** A second clone used to publish upstream commits. */
  other: string;
}

/** A bare remote plus two clones, both on `main`, sharing one base commit. */
async function fixture(): Promise<Fixture> {
  const root = mkScratchDir("gm-incoming-");
  const bare = join(root, "remote.git");
  await $`git -c init.defaultBranch=main init -q --bare ${bare}`.quiet();

  const work = join(root, "work");
  await $`git -c init.defaultBranch=main clone -q ${bare} ${work}`.quiet();
  const W = git(work);
  writeFileSync(join(work, "a.txt"), "line1\n");
  await W("add", "-A");
  await W("commit", "-q", "-m", "base");
  await W("push", "-q", "-u", "origin", "main");

  const other = join(root, "other");
  await $`git clone -q ${bare} ${other}`.quiet();
  return { work, other };
}

const git = (dir: string) => (...a: string[]) =>
  $`git -C ${dir} -c user.name=T -c user.email=t@t.io ${a}`.quiet();

/** Publish two commits upstream: one text change, one binary add. */
async function publishUpstream(other: string): Promise<void> {
  const O = git(other);
  writeFileSync(join(other, "a.txt"), "line1\nline2\nline3\n");
  writeFileSync(join(other, "b.txt"), "new\n");
  await O("add", "-A");
  await O("commit", "-q", "-m", "feat: add b, extend a");
  writeFileSync(join(other, "c.bin"), Buffer.from([0, 1, 2, 0, 255]));
  await O("add", "-A");
  await O("commit", "-q", "-m", "chore: add binary");
  await O("push", "-q", "origin", "main");
}

test("describes a clean fast-forward pull without touching the working tree", async () => {
  const { work, other } = await fixture();
  await publishUpstream(other);
  const before = readFileSync(join(work, "a.txt"), "utf8");
  await git(work)("fetch", "-q");

  const r = await readIncoming(work);
  expect(r.ok).toBe(true);
  expect(r.noUpstream).toBe(false);
  expect(r.upstream).toBe("origin/main");

  // Both upstream commits show up, newest first.
  expect(r.commits.map((c) => c.subject)).toEqual(["chore: add binary", "feat: add b, extend a"]);

  // The net file effect: a.txt grew by 2, b.txt is new, c.bin is binary (counted, no lines).
  const byPath = Object.fromEntries(r.files.map((f) => [f.path, f]));
  expect(byPath["a.txt"]).toMatchObject({ status: "M", addedLines: 2, removedLines: 0, binary: false });
  expect(byPath["b.txt"]).toMatchObject({ status: "A", addedLines: 1, removedLines: 0, binary: false });
  expect(byPath["c.bin"]).toMatchObject({ status: "A", binary: true, addedLines: 0, removedLines: 0 });
  expect(r.stat).toEqual({ filesChanged: 3, addedLines: 3, removedLines: 0 });

  // Nothing of ours to reconcile, so it's a fast-forward and cannot conflict.
  expect(r.fastForward).toBe(true);
  expect(r.conflictCheck).toBe(true);
  expect(r.conflicts).toEqual([]);

  // The whole point: we described the pull without doing it.
  expect(readFileSync(join(work, "a.txt"), "utf8")).toBe(before);
  const dirty = (await $`git -C ${work} status --porcelain`.text()).trim();
  expect(dirty).toBe("");
});

test("predicts a conflict before the pull, still without touching the working tree", async () => {
  const { work, other } = await fixture();
  await publishUpstream(other);
  const W = git(work);

  // Diverge: edit the same line upstream touched.
  writeFileSync(join(work, "a.txt"), "line1\nMINE\n");
  await W("add", "-A");
  await W("commit", "-q", "-m", "local: edit a");
  await W("fetch", "-q");
  const before = readFileSync(join(work, "a.txt"), "utf8");

  const r = await readIncoming(work);
  expect(r.ok).toBe(true);
  expect(r.fastForward).toBe(false); // we have a commit of our own now
  expect(r.conflictCheck).toBe(true);
  expect(r.conflicts).toContain("a.txt");

  // The merge was simulated in the object store only.
  expect(readFileSync(join(work, "a.txt"), "utf8")).toBe(before);
  expect((await $`git -C ${work} status --porcelain`.text()).trim()).toBe("");
  // And no merge was left half-applied.
  const head = (await $`git -C ${work} rev-parse --abbrev-ref HEAD`.text()).trim();
  expect(head).toBe("main");
});

test("a divergence that does not overlap reports no conflict", async () => {
  const { work, other } = await fixture();
  await publishUpstream(other);
  const W = git(work);

  // Our own commit, but in a file upstream never touched.
  writeFileSync(join(work, "mine.txt"), "only mine\n");
  await W("add", "-A");
  await W("commit", "-q", "-m", "local: unrelated file");
  await W("fetch", "-q");

  const r = await readIncoming(work);
  expect(r.fastForward).toBe(false);
  expect(r.conflictCheck).toBe(true);
  expect(r.conflicts).toEqual([]);
  // Our local-only file must NOT appear as incoming: three-dot diff compares against the merge
  // base, so it reports what upstream adds, not what we already have.
  expect(r.files.some((f) => f.path === "mine.txt")).toBe(false);
});

test("reports nothing incoming when already up to date", async () => {
  const { work } = await fixture();
  await git(work)("fetch", "-q");
  const r = await readIncoming(work);
  expect(r.ok).toBe(true);
  expect(r.commits).toEqual([]);
  expect(r.files).toEqual([]);
  expect(r.stat).toEqual({ filesChanged: 0, addedLines: 0, removedLines: 0 });
});

test("a branch with no upstream is a normal state, not an error", async () => {
  const { work } = await fixture();
  const W = git(work);
  await W("checkout", "-q", "-b", "solo");
  const r = await readIncoming(work);
  expect(r.ok).toBe(true);
  expect(r.noUpstream).toBe(true);
  expect(r.upstream).toBe("");
  expect(r.commits).toEqual([]);
});

test("previewing works on a dirty tree and leaves the edits alone", async () => {
  const { work, other } = await fixture();
  await publishUpstream(other);
  const W = git(work);
  await W("fetch", "-q");

  // Uncommitted local edit, of the sort that would block a real merge.
  writeFileSync(join(work, "a.txt"), "line1\nUNCOMMITTED\n");

  const r = await readIncoming(work);
  expect(r.ok).toBe(true);
  expect(r.commits.length).toBe(2);
  // The edit survives untouched: merge-tree never reads the working tree or the index.
  expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("line1\nUNCOMMITTED\n");
});

test("per-commit stats ride along with each incoming commit", async () => {
  const { work, other } = await fixture();
  await publishUpstream(other);
  await git(work)("fetch", "-q");

  const r = await readIncoming(work);
  const feat = r.commits.find((c) => c.subject === "feat: add b, extend a")!;
  expect(feat.stat).toEqual({ filesChanged: 2, addedLines: 3, removedLines: 0 });
  const bin = r.commits.find((c) => c.subject === "chore: add binary")!;
  expect(bin.stat).toEqual({ filesChanged: 1, addedLines: 0, removedLines: 0 });
});
