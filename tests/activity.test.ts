import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import {
  ACTIVITY_AUTHOR_CAP,
  ACTIVITY_COMMIT_CAP,
  ACTIVITY_QUERY_LIMIT,
  ACTIVITY_WINDOW_HOURS,
  aggregateActivity,
  parseGitActivity,
  readFallbackActivity,
  readGitActivity,
  type ActivityCommit,
} from "../src/read/activity.ts";
import { createApp } from "../src/http/app.ts";
import type { RepoYetiConfig } from "../src/config.ts";
import { mustUpsertRepo } from "./helpers/upsert.ts";
import { mkScratchDir } from "./helpers/scratch.ts";

const HOUR_MS = 60 * 60 * 1000;
const localCfg = (): RepoYetiConfig => ({ roots: [], port: 7171, maxDepth: 6, maxRepos: 200 });

function entry(
  date: number,
  authorName: string,
  authorEmail: string,
  stat?: { filesChanged: number; addedLines: number; removedLines: number },
) {
  return {
    hash: `${date}-${authorEmail}`,
    shortHash: String(date).slice(-7),
    subject: "activity",
    authorName,
    authorEmail,
    date,
    refs: "",
    parents: [],
    isMerge: false,
    stat,
  };
}

test("aggregateActivity builds exact rolling totals, contributor groups, and 24 hourly buckets", () => {
  const until = Date.UTC(2026, 6, 24, 18, 30);
  const commits: ActivityCommit[] = [
    {
      authorName: "Alice",
      authorEmail: "ALICE@example.com",
      date: until - 30 * 60 * 1000,
      stat: { filesChanged: 2, addedLines: 3, removedLines: 1 },
    },
    {
      authorName: "Alice Cooper",
      authorEmail: "alice@example.com",
      date: until - 90 * 60 * 1000,
      stat: { filesChanged: 1, addedLines: 2, removedLines: 4 },
    },
    {
      authorName: "Bob",
      authorEmail: "",
      date: until - 5 * HOUR_MS,
    },
    {
      authorName: "Old",
      authorEmail: "old@example.com",
      date: until - 25 * HOUR_MS,
      stat: { filesChanged: 99, addedLines: 99, removedLines: 99 },
    },
  ];

  const result = aggregateActivity(commits, until);
  expect(result.ok).toBe(true);
  expect(result.windowHours).toBe(24);
  expect(result.until - result.since).toBe(24 * HOUR_MS);
  expect(result.commits).toBe(3);
  expect(result.commitsLastHour).toBe(1);
  expect(result.contributors).toBe(2);
  expect(result.filesChanged).toBe(3);
  expect(result.addedLines).toBe(5);
  expect(result.removedLines).toBe(5);
  expect(result.authors).toEqual([
    {
      name: "Alice",
      email: "ALICE@example.com",
      commits: 2,
      addedLines: 5,
      removedLines: 5,
    },
    { name: "Bob", email: "", commits: 1, addedLines: 0, removedLines: 0 },
  ]);
  expect(result.buckets).toHaveLength(ACTIVITY_WINDOW_HOURS);
  expect(result.buckets.map((bucket) => bucket.start)).toEqual(
    Array.from({ length: 24 }, (_, index) => result.since + index * HOUR_MS),
  );
  expect(result.buckets.reduce((sum, bucket) => sum + bucket.commits, 0)).toBe(3);
  expect(result.buckets[23]!.commits).toBe(1);
  expect(result.buckets[22]!.commits).toBe(1);
  expect(result.buckets[19]!.commits).toBe(1);
});

test("aggregateActivity keeps the newest 5000 commits and exposes the cap sentinel", () => {
  const until = Date.UTC(2026, 6, 24, 18, 30);
  const commits: ActivityCommit[] = Array.from({ length: ACTIVITY_QUERY_LIMIT }, (_, index) => ({
    authorName: "Busy",
    authorEmail: "busy@example.com",
    date: until - index,
    stat: { filesChanged: 1, addedLines: 1, removedLines: 0 },
  }));

  const result = aggregateActivity(commits, until);
  expect(result.commits).toBe(ACTIVITY_COMMIT_CAP);
  expect(result.filesChanged).toBe(ACTIVITY_COMMIT_CAP);
  expect(result.addedLines).toBe(ACTIVITY_COMMIT_CAP);
  expect(result.truncated).toBe(true);
});

test("aggregateActivity keeps the contributor count exact while capping ranked author detail", () => {
  const until = Date.UTC(2026, 6, 24, 18, 30);
  const commits: ActivityCommit[] = Array.from({ length: ACTIVITY_AUTHOR_CAP + 5 }, (_, index) => {
    const suffix = String(index).padStart(2, "0");
    return {
      authorName: `User ${suffix}`,
      authorEmail: `user${suffix}@example.com`,
      date: until - index,
      stat: { filesChanged: 1, addedLines: 1, removedLines: 0 },
    };
  });

  const result = aggregateActivity(commits, until);
  expect(result.contributors).toBe(ACTIVITY_AUTHOR_CAP + 5);
  expect(result.authors).toHaveLength(ACTIVITY_AUTHOR_CAP);
  expect(result.authors[0]!.name).toBe("User 00");
  expect(result.authors.at(-1)!.name).toBe("User 24");
});

test("readFallbackActivity reuses normalized log entries and stays honest about a smaller backend cap", async () => {
  const until = Date.UTC(2026, 6, 24, 18, 30);
  let call: unknown[] = [];
  const result = await readFallbackActivity(
    async (...args) => {
      call = args;
      return {
        ok: true,
        code: "OK",
        commits: [
          entry(until - HOUR_MS, "Lore User", "", undefined),
          entry(until - 26 * HOUR_MS, "Old Lore User", "", undefined),
        ],
        hasMore: false,
      };
    },
    "all",
    until,
  );

  expect(call).toEqual([ACTIVITY_QUERY_LIMIT, 0, undefined, "all"]);
  expect(result.commits).toBe(1);
  expect(result.contributors).toBe(1);
  expect(result.filesChanged).toBe(0);
  expect(result.addedLines).toBe(0);
  expect(result.removedLines).toBe(0);
  expect(result.truncated).toBe(false);

  const capped = await readFallbackActivity(
    async () => ({
      ok: true,
      code: "OK",
      commits: [entry(until - HOUR_MS, "Lore User", "", undefined)],
      hasMore: true,
    }),
    "head",
    until,
  );
  expect(capped.truncated).toBe(true);
});

function commitEnv(name: string, email: string, date: number): Record<string, string | undefined> {
  const iso = new Date(date).toISOString();
  return {
    ...process.env,
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  };
}

function splitDateCommitEnv(
  name: string,
  email: string,
  authorDate: number,
  committerDate: number,
): Record<string, string | undefined> {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_AUTHOR_DATE: new Date(authorDate).toISOString(),
    GIT_COMMITTER_DATE: new Date(committerDate).toISOString(),
  };
}

async function commitFile(
  dir: string,
  path: string,
  content: string | Uint8Array,
  message: string,
  name: string,
  email: string,
  date: number,
): Promise<void> {
  writeFileSync(join(dir, path), content);
  await $`git -C ${dir} add -- ${path}`.quiet();
  await $`git -C ${dir} commit -q -m ${message}`.env(commitEnv(name, email, date)).quiet();
}

test("shortstat parser handles translated labels, one-sided changes, and no-stat commits", () => {
  const field = "\x1f";
  const raw = [
    `a${field}Add${field}add@example.com${field}100`,
    " 1 Datei geändert, 7 Zeilen hinzugefügt(+)",
    `b${field}Remove${field}remove@example.com${field}99`,
    " 2 fichiers modifiés, 3 suppressions(-)",
    `c${field}Both${field}both@example.com${field}98`,
    " 4 archivos modificados, 11 inserciones(+), 9 eliminaciones(-)",
    `d${field}Rename${field}rename@example.com${field}97`,
    " 1 bestand gewijzigd",
    `e${field}Binary${field}binary@example.com${field}96`,
    " 1 file changed, 0 insertions(+), 0 deletions(-)",
    `f${field}Empty${field}empty@example.com${field}95`,
  ].join("\n");

  expect(parseGitActivity(raw).map((commit) => commit.stat)).toEqual([
    { filesChanged: 1, addedLines: 7, removedLines: 0 },
    { filesChanged: 2, addedLines: 0, removedLines: 3 },
    { filesChanged: 4, addedLines: 11, removedLines: 9 },
    { filesChanged: 1, addedLines: 0, removedLines: 0 },
    { filesChanged: 1, addedLines: 0, removedLines: 0 },
    { filesChanged: 0, addedLines: 0, removedLines: 0 },
  ]);
});

test("Git shortstat activity counts add-only, delete-only, pure rename, and binary commits", async () => {
  const dir = mkScratchDir("ry-activity-stats-");
  const until = Date.now();
  await $`git -c init.defaultBranch=main init -q ${dir}`.quiet();
  await $`git -C ${dir} config diff.renames true`.quiet();
  await commitFile(
    dir,
    "seed.txt",
    "seed\n",
    "old seed",
    "Seed",
    "seed@example.com",
    until - 26 * HOUR_MS,
  );
  await commitFile(
    dir,
    "lines.txt",
    "one\ntwo\nthree\n",
    "add lines",
    "Add Author",
    "add@example.com",
    until - 4 * HOUR_MS,
  );
  await commitFile(
    dir,
    "lines.txt",
    "one\n",
    "remove lines",
    "Delete Author",
    "delete@example.com",
    until - 3 * HOUR_MS,
  );
  await $`git -C ${dir} mv -- lines.txt renamed.txt`.quiet();
  await $`git -C ${dir} commit -q -m "rename only"`
    .env(commitEnv("Rename Author", "rename@example.com", until - 2 * HOUR_MS))
    .quiet();
  await commitFile(
    dir,
    "binary.bin",
    new Uint8Array([0, 1, 2, 0, 3]),
    "binary add",
    "Binary Author",
    "binary@example.com",
    until - HOUR_MS,
  );

  const result = await readGitActivity(dir, "head", until);
  expect(result.ok).toBe(true);
  expect(result.commits).toBe(4);
  expect(result.filesChanged).toBe(4);
  expect(result.addedLines).toBe(3);
  expect(result.removedLines).toBe(2);
  expect(result.authors.find((author) => author.email === "add@example.com")).toMatchObject({
    addedLines: 3,
    removedLines: 0,
  });
  expect(result.authors.find((author) => author.email === "delete@example.com")).toMatchObject({
    addedLines: 0,
    removedLines: 2,
  });
  expect(result.authors.find((author) => author.email === "rename@example.com")).toMatchObject({
    addedLines: 0,
    removedLines: 0,
  });
  expect(result.authors.find((author) => author.email === "binary@example.com")).toMatchObject({
    addedLines: 0,
    removedLines: 0,
  });
});

test("Git activity matches History author dates and canonicalizes contributors through mailmap", async () => {
  const dir = mkScratchDir("ry-activity-identity-");
  const until = Date.now();
  await $`git -c init.defaultBranch=main init -q ${dir}`.quiet();

  writeFileSync(join(dir, ".mailmap"), "Canonical Coder <canonical@example.com> Alias Coder <alias@example.com>\n");
  writeFileSync(join(dir, "rebased.txt"), "old authored work\n");
  await $`git -C ${dir} add -- .mailmap rebased.txt`.quiet();
  await $`git -C ${dir} commit -q -m "rebased old work"`
    .env(
      splitDateCommitEnv(
        "Alias Coder",
        "alias@example.com",
        until - 48 * HOUR_MS,
        until - 2 * HOUR_MS,
      ),
    )
    .quiet();

  await commitFile(
    dir,
    "recent.txt",
    "recent\n",
    "recent canonical work",
    "Alias Coder",
    "alias@example.com",
    until - HOUR_MS,
  );

  const result = await readGitActivity(dir, "head", until);
  expect(result.ok).toBe(true);
  // The rebased commit has a recent committer timestamp but the old author timestamp shown by
  // History, so it must not leak into today's chart.
  expect(result.commits).toBe(1);
  expect(result.authors).toEqual([
    {
      name: "Canonical Coder",
      email: "canonical@example.com",
      commits: 1,
      addedLines: 1,
      removedLines: 0,
    },
  ]);
});

test("Git activity respects the 24-hour window and ref scope, and counts a merge with zero stats", async () => {
  const dir = mkScratchDir("ry-activity-");
  const until = Date.now();
  await $`git -c init.defaultBranch=main init -q ${dir}`.quiet();
  await commitFile(
    dir,
    "seed.txt",
    "old\n",
    "old seed",
    "Old",
    "old@example.com",
    until - 26 * HOUR_MS,
  );

  await $`git -C ${dir} checkout -q -b feature`.quiet();
  await commitFile(
    dir,
    "feature.txt",
    "one\ntwo\n",
    "feature work",
    "Feature Author",
    "feature@example.com",
    until - 2 * HOUR_MS,
  );
  await $`git -C ${dir} checkout -q main`.quiet();
  await commitFile(
    dir,
    "main.txt",
    "main\n",
    "main work",
    "Main Author",
    "main@example.com",
    until - 90 * 60 * 1000,
  );

  const headBeforeMerge = await readGitActivity(dir, "head", until);
  const allBeforeMerge = await readGitActivity(dir, "all", until);
  expect(headBeforeMerge.commits).toBe(1);
  expect(headBeforeMerge.addedLines).toBe(1);
  expect(allBeforeMerge.commits).toBe(2);
  expect(allBeforeMerge.filesChanged).toBe(2);
  expect(allBeforeMerge.addedLines).toBe(3);
  expect(allBeforeMerge.contributors).toBe(2);

  await $`git -C ${dir} merge --no-ff -q -m "merge feature" feature`
    .env(commitEnv("Merge Bot", "merge@example.com", until - 20 * 60 * 1000))
    .quiet();
  const merged = await readGitActivity(dir, "head", until);
  expect(merged.ok).toBe(true);
  expect(merged.commits).toBe(3);
  expect(merged.commitsLastHour).toBe(1);
  expect(merged.contributors).toBe(3);
  // The merge is a commit, but plain `git log --shortstat` gives it no duplicate diff summary.
  expect(merged.filesChanged).toBe(2);
  expect(merged.addedLines).toBe(3);
  expect(merged.removedLines).toBe(0);
  expect(merged.truncated).toBe(false);
  expect(merged.buckets.reduce((sum, bucket) => sum + bucket.commits, 0)).toBe(3);

  const id = mustUpsertRepo(dir, "activity-route", "auto", false);
  const app = createApp(localCfg());
  const response = await app.request(`/api/repos/${id}/activity?refs=all`);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.ok).toBe(true);
  expect(body.windowHours).toBe(24);
  expect(body.commits).toBe(3);
  expect(body.buckets).toHaveLength(24);
  expect(body.until - body.since).toBe(24 * HOUR_MS);
  expect((await app.request("/api/repos/missing/activity")).status).toBe(404);
});
