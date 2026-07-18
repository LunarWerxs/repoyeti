/**
 * "What would a pull actually do?" — read-only, computed entirely from objects git ALREADY has.
 *
 * The whole feature rests on one fact: `git pull` is `git fetch` + `git merge`. The fetch half
 * downloads every incoming object into the local object store and moves the remote-tracking ref
 * (origin/main); the merge half is what touches your working tree. So once a fetch has run, the
 * commits, the file list, the line counts and the patches are all sitting in `.git` and can be
 * read without going near the tree. Nothing here mutates anything.
 *
 * Three git reads, none of which touch the working tree or the index:
 *   · `log HEAD..@{u}`             — the commits you don't have yet
 *   · `diff --numstat HEAD...@{u}` — the net file/line effect (three dots = compare against the
 *                                    merge base, so it excludes YOUR local-only commits; that
 *                                    matches what merging actually brings in)
 *   · `merge-tree --write-tree`    — a full merge simulated in memory. Exits non-zero and names
 *                                    the paths when the merge would conflict, which is the part
 *                                    most git GUIs make you discover by attempting the merge and
 *                                    then backing out.
 */
import { gitFor } from "../git.ts";
import { readGate } from "../gitgate.ts";
import type { CommitStat, LogEntry } from "./inspect.ts";

const US = "\x1f"; // field separator — see inspect.ts

/** Cap the previewed commit list; a phone can't scroll 400 commits usefully. */
export const MAX_INCOMING_COMMITS = 100;
/** Cap the previewed file list for the same reason. */
export const MAX_INCOMING_FILES = 500;

/** One file a pull would change, with its net line delta. */
export interface IncomingFile {
  path: string;
  /** A (added) / M (modified) / D (deleted), derived from the numstat + name-status pair. */
  status: string;
  addedLines: number;
  removedLines: number;
  /** True when git reported the file as binary ("-" for both counts). */
  binary: boolean;
}

export interface IncomingResult {
  ok: boolean;
  code: "OK" | "ERROR";
  message?: string;
  /** The upstream ref this compares against, e.g. "origin/main". Empty when none is configured. */
  upstream: string;
  /** True when the branch has no upstream at all — nothing to preview, and nothing to pull. */
  noUpstream: boolean;
  /** Commits present upstream but not locally, newest first. */
  commits: LogEntry[];
  /** True when the commit list was capped (there are more than MAX_INCOMING_COMMITS). */
  commitsTruncated: boolean;
  /** Files the merge would change, with net line deltas. */
  files: IncomingFile[];
  /** True when the file list was capped. */
  filesTruncated: boolean;
  /** Aggregate across every incoming file (uncapped totals, even if the lists were truncated). */
  stat: CommitStat;
  /**
   * Paths that would conflict if you pulled right now, from a simulated in-memory merge.
   * Empty means the merge is expected to apply cleanly. Absent capability (very old git)
   * surfaces as `conflictCheck: false` rather than a false "clean".
   */
  conflicts: string[];
  /** False when this git couldn't run the merge simulation, so `conflicts` says nothing. */
  conflictCheck: boolean;
  /** True when the merge would fast-forward (no local commits of your own to reconcile). */
  fastForward: boolean;
}

const empty = (code: "OK" | "ERROR", message?: string): IncomingResult => ({
  ok: code === "OK",
  code,
  message,
  upstream: "",
  noUpstream: true,
  commits: [],
  commitsTruncated: false,
  files: [],
  filesTruncated: false,
  stat: { filesChanged: 0, addedLines: 0, removedLines: 0 },
  conflicts: [],
  conflictCheck: false,
  fastForward: false,
});

/** Parse one `--numstat` row: "<added>\t<removed>\t<path>" ("-" counts mean binary). */
function parseNumstat(line: string): { path: string; added: number; removed: number; binary: boolean } | null {
  const [addedRaw = "", removedRaw = "", ...rest] = line.split("\t");
  if (rest.length === 0) return null;
  const binary = addedRaw === "-" || removedRaw === "-";
  return {
    // A rename shows as "old => new" (or the brace form); keep git's own rendering rather than
    // trying to re-derive a single path from it.
    path: rest.join("\t"),
    added: binary ? 0 : Number(addedRaw) || 0,
    removed: binary ? 0 : Number(removedRaw) || 0,
    binary,
  };
}

/**
 * Everything a pull would bring in. Reflects the last fetch: if nothing has fetched recently the
 * answer is simply "nothing incoming", which is why callers fetch first (see the service layer).
 */
export async function readIncoming(absPath: string): Promise<IncomingResult> {
  try {
    return await readGate.run(async () => {
      const git = gitFor(absPath);

      // Resolve the upstream. No upstream (or a detached HEAD) is a normal state, not an error.
      let upstream = "";
      try {
        upstream = (await git.raw(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).trim();
      } catch {
        return { ...empty("OK"), message: undefined };
      }
      if (!upstream) return empty("OK");

      // ── the commits you don't have ────────────────────────────────────────────────
      // Same field layout as readLog (subject last so an odd character can't shift a field),
      // with --numstat folded in for the per-commit totals the history table already shows.
      const fmt = ["%H", "%h", "%an", "%ae", "%at", "%P", "%D", "%s"].join(US);
      let rawLog = "";
      try {
        rawLog = await git.raw([
          "log",
          "--no-color",
          `--max-count=${MAX_INCOMING_COMMITS + 1}`, // +1 so we can detect truncation
          "--numstat",
          `--pretty=format:${fmt}`,
          `HEAD..${upstream}`,
        ]);
      } catch {
        rawLog = ""; // unborn HEAD, or an upstream that points at nothing yet
      }
      const commits: LogEntry[] = [];
      for (const line of rawLog.split("\n")) {
        if (line.trim() === "") continue;
        if (line.includes(US)) {
          const [hash = "", shortHash = "", authorName = "", authorEmail = "", at = "0", parentsRaw = "", refs = "", subject = ""] =
            line.split(US);
          const parents = parentsRaw.trim() ? parentsRaw.trim().split(" ") : [];
          commits.push({
            hash, shortHash, subject, authorName, authorEmail,
            date: Number(at) * 1000,
            refs: refs.trim(),
            parents,
            isMerge: parents.length > 1,
            stat: { filesChanged: 0, addedLines: 0, removedLines: 0 },
          });
          continue;
        }
        const current = commits.at(-1);
        if (!current?.stat) continue;
        const row = parseNumstat(line);
        if (!row) continue;
        current.stat.filesChanged += 1;
        current.stat.addedLines += row.added;
        current.stat.removedLines += row.removed;
      }
      const commitsTruncated = commits.length > MAX_INCOMING_COMMITS;
      if (commitsTruncated) commits.length = MAX_INCOMING_COMMITS;

      // ── the net file effect ───────────────────────────────────────────────────────
      // Three dots: compare the upstream tip against the MERGE BASE, not against HEAD. Two dots
      // would also report your own local-only commits inverted, which is not what a pull brings.
      let files: IncomingFile[] = [];
      const stat: CommitStat = { filesChanged: 0, addedLines: 0, removedLines: 0 };
      if (commits.length > 0 || commitsTruncated) {
        // status letters and line counts come from two passes over the same range, keyed by path
        const statusByPath = new Map<string, string>();
        try {
          const rawStatus = await git.raw(["diff", "--name-status", "--no-color", `HEAD...${upstream}`]);
          for (const l of rawStatus.split("\n")) {
            const t = l.trim();
            if (!t) continue;
            const parts = t.split("\t");
            const letter = (parts[0] ?? "M")[0] ?? "M";
            const path = letter === "R" || letter === "C" ? (parts[2] ?? "") : (parts[1] ?? "");
            if (path) statusByPath.set(path, letter);
          }
        } catch {
          /* status letters are a nicety; the numstat below is the substance */
        }
        try {
          const rawNum = await git.raw(["diff", "--numstat", "--no-color", `HEAD...${upstream}`]);
          const all: IncomingFile[] = [];
          for (const l of rawNum.split("\n")) {
            if (l.trim() === "") continue;
            const row = parseNumstat(l);
            if (!row) continue;
            stat.filesChanged += 1;
            stat.addedLines += row.added;
            stat.removedLines += row.removed;
            all.push({
              path: row.path,
              status: statusByPath.get(row.path) ?? "M",
              addedLines: row.added,
              removedLines: row.removed,
              binary: row.binary,
            });
          }
          files = all.slice(0, MAX_INCOMING_FILES);
        } catch {
          /* leave files empty; the commit list still tells the story */
        }
      }

      // ── would it conflict? ────────────────────────────────────────────────────────
      // `merge-tree --write-tree` performs the whole merge against the object store and writes
      // the result as a tree object. It never reads or writes the working tree or the index, so
      // this is safe to run on a dirty repo. Non-zero exit means conflicts; the "CONFLICT (...)"
      // lines name the paths. Older git lacks --write-tree entirely, hence conflictCheck.
      let conflicts: string[] = [];
      let conflictCheck = false;
      let fastForward = false;
      if (commits.length > 0 || commitsTruncated) {
        try {
          // Behind-only (a pure fast-forward) can't conflict: there is nothing of yours to merge.
          const localOnly = (await git.raw(["rev-list", "--count", `${upstream}..HEAD`])).trim();
          fastForward = localOnly === "0";
        } catch {
          /* leave fastForward false — the merge simulation below still runs */
        }
        if (fastForward) {
          conflictCheck = true; // a fast-forward is conflict-free by definition
        } else {
          try {
            // Output shape (git's documented `--write-tree` format):
            //   <OID of the merged toplevel tree>
            //   <one conflicted path per line, from --name-only>
            //   <blank line>
            //   <informational messages, e.g. "CONFLICT (content): ...">
            // A clean merge emits the OID and nothing else. Parse the path block rather than the
            // human-readable CONFLICT lines: the block is machine-oriented and stable, whereas
            // those messages are prose that varies by conflict type. Note simple-git RESOLVES
            // here even though git exits 1 on conflicts, so the exit code is not available to us
            // and the output is the only signal.
            const out = await git.raw(["merge-tree", "--write-tree", "--name-only", "HEAD", upstream]);
            conflictCheck = true;
            const lines = out.split("\n");
            const paths: string[] = [];
            for (const line of lines.slice(1)) {
              if (line.trim() === "") break; // blank line closes the conflicted-path block
              paths.push(line);
            }
            conflicts = paths;
          } catch {
            // Old git without --write-tree (or the merge could not be simulated at all). Say so
            // rather than reporting a clean merge we never actually checked.
            conflictCheck = false;
          }
        }
      }

      return {
        ok: true,
        code: "OK" as const,
        upstream,
        noUpstream: false,
        commits,
        commitsTruncated,
        files,
        filesTruncated: stat.filesChanged > files.length,
        stat,
        conflicts,
        conflictCheck,
        fastForward,
      };
    });
  } catch (e) {
    return empty("ERROR", e instanceof Error ? e.message : String(e));
  }
}
