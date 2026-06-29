import { relative, isAbsolute } from "node:path";

/**
 * True when `p` is `root` itself or sits inside it — the canonical path-confinement check that
 * blocks `../` escapes. Used for BOTH scan-root membership (clone/discovery) and the file-viewer/
 * editor path-safety guards. One definition so a fix (e.g. a Windows drive-letter edge case)
 * lands in every caller at once.
 */
export function pathWithin(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
