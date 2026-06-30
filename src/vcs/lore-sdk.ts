/**
 * Lore reads via the structured SDK (`@lore-vcs/sdk`) instead of scraping the CLI's human text.
 *
 * The CLI has NO machine-readable output, so its text format WILL drift as Lore (pre-1.0) evolves
 * and break regex parsers. The SDK is a native-FFI (koffi) binding that returns typed events, so it
 * is drift-proof — see docs/TODO.md "SDK migration".
 *
 * Two safety properties:
 *  - **Lazy**: the native binding is `import()`-ed only on first use, so a git-only daemon never
 *    loads it (lore.ts is already dormant unless REPOYETI_LORE=1).
 *  - **Fallback**: every export returns `null` when the SDK can't load (a platform without the
 *    native lib, a `bun --compile` build that didn't bundle it). Callers fall back to the CLI
 *    parsers in lore.ts, so Lore never breaks just because the SDK is absent.
 */
import type { ChangedFile } from "../status.ts";

// undefined = not yet tried · null = unavailable (fall back to CLI) · module = loaded.
let mod: typeof import("@lore-vcs/sdk") | null | undefined;
async function sdk(): Promise<typeof import("@lore-vcs/sdk") | null> {
  if (mod !== undefined) return mod;
  try {
    mod = await import("@lore-vcs/sdk");
  } catch {
    mod = null; // native lib missing / load failed → CLI fallback
  }
  return mod;
}

/** LoreFileAction (KEEP/ADD/DELETE/MOVE/COPY) → the one-letter status the UI already speaks.
 *  A KEEP'd-but-dirty file is a modification. */
const ACTION_LETTER: Record<number, string> = { 0: "M", 1: "A", 2: "D", 3: "R", 4: "C" };

// LoreEventTag values we read (full enum in @lore-vcs/sdk).
const TAG_COMPLETE = 2;
const TAG_STATUS_REVISION = 151;
const TAG_STATUS_FILE = 152;

type LoreEvt = { tag: number; data?: Record<string, unknown> };

export interface SdkStatus {
  branch: string | null;
  files: ChangedFile[];
}

/**
 * Repository status via the SDK: the current branch + the changed-file set, as structured data.
 * Returns `null` when the SDK is unavailable or the op reported an error, so the caller falls back
 * to the CLI path. `offline` avoids a server round-trip (status only needs the local working copy).
 */
export async function sdkStatus(repoPath: string): Promise<SdkStatus | null> {
  const m = await sdk();
  if (!m) return null;
  try {
    const events = (await m.lore
      .repositoryStatus({ repositoryPath: repoPath, offline: true }, { scan: true })
      .collectAsync()) as unknown as ReadonlyArray<LoreEvt>;
    let ok = false;
    let branch: string | null = null;
    const files: ChangedFile[] = [];
    for (const e of events) {
      const d = e.data ?? {};
      if (e.tag === TAG_STATUS_REVISION) {
        branch = d.branchName != null ? String(d.branchName) : null;
      } else if (e.tag === TAG_STATUS_FILE) {
        files.push({
          path: String(d.path ?? ""),
          status: ACTION_LETTER[Number(d.action ?? 0)] ?? "M",
          staged: Boolean(d.flagStaged),
        });
      } else if (e.tag === TAG_COMPLETE) {
        ok = Number(d.status ?? 1) === 0;
      }
    }
    return ok ? { branch, files } : null;
  } catch {
    return null;
  }
}
