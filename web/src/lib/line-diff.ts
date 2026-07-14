// Line-level diff for the file viewer's "dirty diff" gutter (VS Code-style: green added, blue
// modified, red-triangle deleted markers shown in Content mode, not just the Diff tab).
//
// Strategy: trim the common prefix + suffix (the overwhelming majority of an edited file), then run
// an LCS over just the differing MIDDLE. That makes the common case (a few changed lines in a big
// file) trivially cheap, and bounds the worst case (a full rewrite) by capping the middle we
// LCS-over. All ranges are 1-based inclusive line numbers in the MODIFIED (working-tree) text, so
// they line up with what Content mode is showing.

export type LineChangeKind = "add" | "modify" | "delete";

export interface LineChange {
  /** 1-based inclusive start line (MODIFIED text). For a pure "delete", the line now sitting where
   *  content was removed (endLine === startLine) — the gutter renders a triangle marker there. */
  startLine: number;
  endLine: number;
  kind: LineChangeKind;
}

/** Split into lines, dropping the empty element a trailing newline produces (it's not a real line). */
function toLines(s: string): string[] {
  if (s === "") return [];
  const lines = s.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// Above this many differing middle lines we don't LCS (would be slow/memory-heavy); the whole
// middle is reported as one "modify" block instead — still a useful gutter, just coarser.
const MAX_LCS = 2500;

/** A pure deletion has no modified line of its own; mark the line now sitting just after the gap
 *  (clamped to the file — a deletion at EOF marks the last line). */
const deleteMarker = (base: number, offset: number, modTotal: number): LineChange => {
  const at = Math.max(1, Math.min(base + offset + 1, modTotal || 1));
  return { startLine: at, endLine: at, kind: "delete" };
};

/** LCS-backed edit script over two line arrays → grouped changes, offset into the full modified text. */
function diffMiddle(a: string[], b: string[], base: number, modTotal: number): LineChange[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ startLine: base + 1, endLine: base + m, kind: "add" }];
  if (m === 0) return [deleteMarker(base, 0, modTotal)];
  if (n > MAX_LCS || m > MAX_LCS) return [{ startLine: base + 1, endLine: base + m, kind: "modify" }];

  // dp[i][j] = LCS length of a[i..] and b[j..].
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }

  const changes: LineChange[] = [];
  let i = 0;
  let j = 0;
  // A pending run of deletions/insertions between two equal anchors, flushed as add/modify/delete.
  let delRun = 0;
  let insStart = -1; // 0-based index into b where the current insertion run began
  let insCount = 0;
  const flush = (): void => {
    if (delRun === 0 && insCount === 0) return;
    if (insCount > 0) {
      const start = base + insStart + 1;
      const end = base + insStart + insCount;
      // Deletions paired with insertions read as a MODIFY; pure insertions read as ADD.
      changes.push({ startLine: start, endLine: end, kind: delRun > 0 ? "modify" : "add" });
    } else {
      // Pure deletion (lines removed, nothing added) → a marker on the line now at this spot.
      changes.push(deleteMarker(base, j, modTotal));
    }
    delRun = 0;
    insStart = -1;
    insCount = 0;
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      // Deletion from a (advance i).
      delRun++;
      i++;
    } else {
      // Insertion from b (advance j).
      if (insCount === 0) insStart = j;
      insCount++;
      j++;
    }
  }
  // Tail: remaining deletions and/or insertions.
  while (i < n) {
    delRun++;
    i++;
  }
  while (j < m) {
    if (insCount === 0) insStart = j;
    insCount++;
    j++;
  }
  flush();
  return changes;
}

/**
 * Compute the changed-line ranges of `modified` vs `original`, for the dirty-diff gutter.
 * Returns [] when the texts are identical.
 */
export function diffLineChanges(original: string, modified: string): LineChange[] {
  if (original === modified) return [];
  const a = toLines(original);
  const b = toLines(modified);

  // Trim common prefix.
  let p = 0;
  const minLen = Math.min(a.length, b.length);
  while (p < minLen && a[p] === b[p]) p++;
  // Trim common suffix (not overlapping the prefix).
  let s = 0;
  while (s < minLen - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;

  return diffMiddle(a.slice(p, a.length - s), b.slice(p, b.length - s), p, b.length);
}
