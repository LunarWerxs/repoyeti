/**
 * Bounded 24-hour repository activity for the History overview.
 *
 * Git gets one purpose-built `git log --since/--until --shortstat` query so the totals do not
 * depend on which paginated History rows the browser happens to have loaded. Other backends
 * reuse their normalized readLog result through `readFallbackActivity`.
 */
import { gitFor } from "../git.ts";
import { readGate } from "../gitgate.ts";
import type { CommitStat, LogResult, RefScope } from "./inspect.ts";

export const ACTIVITY_WINDOW_HOURS = 24;
export const ACTIVITY_COMMIT_CAP = 5000;
/** Enough detail for compact contributor chips without shipping thousands of identities. */
export const ACTIVITY_AUTHOR_CAP = 25;
/** One extra record tells the caller that the bounded result is incomplete. */
export const ACTIVITY_QUERY_LIMIT = ACTIVITY_COMMIT_CAP + 1;

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = ACTIVITY_WINDOW_HOURS * HOUR_MS;
const US = "\x1f";

export interface ActivityAuthor {
  name: string;
  email: string;
  commits: number;
  addedLines: number;
  removedLines: number;
}

export interface ActivityBucket {
  /** Bucket start as epoch milliseconds. Buckets are rolling one-hour slices from `since`. */
  start: number;
  commits: number;
  filesChanged: number;
  addedLines: number;
  removedLines: number;
}

export interface ActivityResult {
  ok: boolean;
  code: "OK" | "ERROR";
  message?: string;
  windowHours: typeof ACTIVITY_WINDOW_HOURS;
  /** Inclusive rolling-window start as epoch milliseconds. */
  since: number;
  /** Window end as epoch milliseconds (the server snapshot time). */
  until: number;
  commits: number;
  commitsLastHour: number;
  /** Exact number of unique normalized authors in the bounded window. */
  contributors: number;
  filesChanged: number;
  addedLines: number;
  removedLines: number;
  /** Top authors by commit count/change volume, capped at ACTIVITY_AUTHOR_CAP. */
  authors: ActivityAuthor[];
  buckets: ActivityBucket[];
  /** True when more than ACTIVITY_COMMIT_CAP commits may fall inside the window. */
  truncated: boolean;
}

export interface ActivityCommit {
  authorName: string;
  authorEmail: string;
  /** Commit/author date as epoch milliseconds. */
  date: number;
  stat?: CommitStat;
}

function nonNegativeInt(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

function authorKey(commit: ActivityCommit): string {
  const email = commit.authorEmail.trim().toLowerCase();
  if (email) return `email:${email}`;
  return `name:${commit.authorName.trim().toLowerCase()}`;
}

/**
 * Aggregate normalized commits into the stable response shape. Exported so fallback backends and
 * focused tests share the exact same window, cap, author grouping, and bucket rules.
 */
export function aggregateActivity(
  commits: readonly ActivityCommit[],
  until = Date.now(),
  sourceTruncated = false,
): ActivityResult {
  const safeUntil = Number.isFinite(until) ? Math.floor(until) : Date.now();
  const since = safeUntil - WINDOW_MS;
  const inWindow = commits
    .filter((commit) => Number.isFinite(commit.date) && commit.date >= since && commit.date <= safeUntil)
    .sort((a, b) => b.date - a.date);
  const truncated = sourceTruncated || inWindow.length > ACTIVITY_COMMIT_CAP;
  const bounded = inWindow.slice(0, ACTIVITY_COMMIT_CAP);
  const buckets: ActivityBucket[] = Array.from({ length: ACTIVITY_WINDOW_HOURS }, (_, index) => ({
    start: since + index * HOUR_MS,
    commits: 0,
    filesChanged: 0,
    addedLines: 0,
    removedLines: 0,
  }));
  const byAuthor = new Map<string, ActivityAuthor>();
  let commitsLastHour = 0;
  let filesChanged = 0;
  let addedLines = 0;
  let removedLines = 0;

  for (const commit of bounded) {
    const files = nonNegativeInt(commit.stat?.filesChanged);
    const added = nonNegativeInt(commit.stat?.addedLines);
    const removed = nonNegativeInt(commit.stat?.removedLines);
    filesChanged += files;
    addedLines += added;
    removedLines += removed;
    if (commit.date >= safeUntil - HOUR_MS) commitsLastHour += 1;

    // A commit exactly at `until` belongs to the final bucket rather than falling one past it.
    const bucketIndex = Math.min(
      ACTIVITY_WINDOW_HOURS - 1,
      Math.max(0, Math.floor((commit.date - since) / HOUR_MS)),
    );
    const bucket = buckets[bucketIndex]!;
    bucket.commits += 1;
    bucket.filesChanged += files;
    bucket.addedLines += added;
    bucket.removedLines += removed;

    const key = authorKey(commit);
    const current = byAuthor.get(key);
    if (current) {
      current.commits += 1;
      current.addedLines += added;
      current.removedLines += removed;
      if (!current.name && commit.authorName) current.name = commit.authorName;
      if (!current.email && commit.authorEmail) current.email = commit.authorEmail;
    } else {
      byAuthor.set(key, {
        name: commit.authorName,
        email: commit.authorEmail,
        commits: 1,
        addedLines: added,
        removedLines: removed,
      });
    }
  }

  const rankedAuthors = [...byAuthor.values()].sort(
    (a, b) =>
      b.commits - a.commits ||
      b.addedLines + b.removedLines - (a.addedLines + a.removedLines) ||
      a.name.localeCompare(b.name) ||
      a.email.localeCompare(b.email),
  );
  const contributors = rankedAuthors.length;
  const authors = rankedAuthors.slice(0, ACTIVITY_AUTHOR_CAP);
  return {
    ok: true,
    code: "OK",
    windowHours: ACTIVITY_WINDOW_HOURS,
    since,
    until: safeUntil,
    commits: bounded.length,
    commitsLastHour,
    contributors,
    filesChanged,
    addedLines,
    removedLines,
    authors,
    buckets,
    truncated,
  };
}

export function activityError(message: string, until = Date.now()): ActivityResult {
  return { ...aggregateActivity([], until), ok: false, code: "ERROR", message };
}

interface ParsedActivityCommit extends ActivityCommit {
  hash: string;
}

/** Parse the bounded, path-free `git log --shortstat` stream. Exported for focused format tests. */
export function parseGitActivity(raw: string): ParsedActivityCommit[] {
  const commits: ParsedActivityCommit[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    if (line.includes(US)) {
      const [hash = "", authorName = "", authorEmail = "", committedAt = "0"] = line.split(US);
      commits.push({
        hash,
        authorName,
        authorEmail,
        date: Number(committedAt) * 1000,
        stat: { filesChanged: 0, addedLines: 0, removedLines: 0 },
      });
      continue;
    }
    const current = commits.at(-1);
    if (!current?.stat) continue;
    // `--shortstat` emits at most one compact summary per commit instead of one `--numstat`
    // record per changed path. Match the stable (+)/(-) markers rather than English words so this
    // remains correct under a localized Git installation.
    const files = line.match(/^\s*(\d+)/);
    const added = line.match(/(\d+)\s+[^,\n]*\(\+\)/);
    const removed = line.match(/(\d+)\s+[^,\n]*\(-\)/);
    if (!files && !added && !removed) continue;
    current.stat.filesChanged = Number(files?.[1] ?? 0);
    current.stat.addedLines = Number(added?.[1] ?? 0);
    current.stat.removedLines = Number(removed?.[1] ?? 0);
  }
  return commits;
}

function scopeArgs(refScope: RefScope): string[] {
  return refScope === "all"
    ? ["HEAD", "--branches", "--tags", "--remotes", "--date-order"]
    : refScope === "local"
      ? ["HEAD", "--branches", "--tags", "--date-order"]
      : [];
}

function unbornHead(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not have any commits yet|bad default revision ['"]?HEAD|ambiguous argument ['"]?HEAD/i.test(message);
}

/**
 * Accurate Git activity from one bounded process. `%at` matches the author date displayed by
 * History rows, while `%aN`/`%aE` honor `.mailmap` so contributor aliases stay grouped.
 * Git's `--since`/`--until` prefilter is based on committer time; the shared aggregator applies
 * the authoritative author-date window after parsing.
 */
export async function readGitActivity(
  absPath: string,
  refScope: RefScope = "head",
  until = Date.now(),
): Promise<ActivityResult> {
  const safeUntil = Number.isFinite(until) ? Math.floor(until) : Date.now();
  const since = safeUntil - WINDOW_MS;
  try {
    return await readGate.run(async () => {
      const format = ["%H", "%aN", "%aE", "%at"].join(US);
      try {
        const raw = await gitFor(absPath).raw([
          "log",
          "--no-color",
          ...scopeArgs(refScope),
          `--since=${new Date(since).toISOString()}`,
          `--until=${new Date(safeUntil).toISOString()}`,
          `--max-count=${ACTIVITY_QUERY_LIMIT}`,
          // One summary line per commit keeps the captured output bounded by commit count.
          // `--numstat` can emit millions of path rows for a busy monorepo in this same window.
          "--shortstat",
          `--pretty=format:${format}`,
        ]);
        const commits = parseGitActivity(raw);
        return aggregateActivity(commits, safeUntil, commits.length > ACTIVITY_COMMIT_CAP);
      } catch (error) {
        if (unbornHead(error)) return aggregateActivity([], safeUntil);
        return activityError(error instanceof Error ? error.message : String(error), safeUntil);
      }
    });
  } catch (error) {
    return activityError(error instanceof Error ? error.message : String(error), safeUntil);
  }
}

type LogReader = (
  limit?: number,
  skip?: number,
  merges?: "only" | "exclude",
  refScope?: RefScope,
) => Promise<LogResult>;

/**
 * Graceful non-Git fallback. Backends already normalize identity/date/stat into LogEntry, so ask
 * for one cap+sentinel page and feed it through the shared aggregator. If a backend applies a
 * smaller internal cap and says there is more while every returned commit is still in-window,
 * `truncated` stays honest.
 */
export async function readFallbackActivity(
  readLog: LogReader,
  refScope: RefScope = "head",
  until = Date.now(),
): Promise<ActivityResult> {
  const safeUntil = Number.isFinite(until) ? Math.floor(until) : Date.now();
  const since = safeUntil - WINDOW_MS;
  try {
    const result = await readLog(ACTIVITY_QUERY_LIMIT, 0, undefined, refScope);
    if (!result.ok) return activityError(result.message ?? "activity unavailable", safeUntil);
    const possiblyIncompleteWindow =
      result.hasMore &&
      (result.commits.length === 0 ||
        result.commits.every((commit) => Number.isFinite(commit.date) && commit.date >= since));
    return aggregateActivity(result.commits, safeUntil, possiblyIncompleteWindow);
  } catch (error) {
    return activityError(error instanceof Error ? error.message : String(error), safeUntil);
  }
}
