import type { Hono } from "hono";
import type { Deps } from "../deps.ts";
import { getLog, getCommit, getIncoming, fetchRepo } from "../../service/index.ts";
import { withRepo } from "../respond.ts";

export function register(app: Hono, _deps: Deps): void {
  // ── commit history (read-only, paginated) ────────────────────────────────────
  app.get("/api/repos/:id/log", (c) =>
    withRepo(c, async (id) => {
      const limit = Number(c.req.query("limit"));
      const skip = Number(c.req.query("skip"));
      // ?merges=only → just merge commits · ?merges=exclude → drop them · absent → all.
      const m = c.req.query("merges");
      const merges = m === "only" || m === "exclude" ? m : undefined;
      // ?refs=head (default, current branch) · local (all local branches+tags) · all (+remotes).
      // The graph view's branch-scope toggle drives this; anything else falls back to head-only.
      const r = c.req.query("refs");
      const refs = r === "all" || r === "local" || r === "head" ? r : undefined;
      return c.json(
        await getLog(
          id,
          Number.isFinite(limit) ? limit : undefined,
          Number.isFinite(skip) ? skip : undefined,
          merges,
          refs,
        ),
      );
    }),
  );

  // One commit's detail (changed files + bounded diff) — the History "tap a commit" view.
  app.get("/api/repos/:id/commit/:hash", (c) =>
    withRepo(c, async (id) => c.json(await getCommit(id, c.req.param("hash")))),
  );

  // ── "what would a pull do?" (read-only) ──────────────────────────────────────
  // Everything this reports comes from objects a fetch has already downloaded, so with
  // ?fetch=1 (what the Preview Pull button sends) we fetch FIRST and then describe. Without
  // that the answer would silently reflect whenever the last background sync happened, which
  // for a preview is worse than useless: it would show "nothing incoming" on a stale ref.
  // The fetch is the only side effect, and fetch never touches the working tree.
  app.get("/api/repos/:id/incoming", (c) =>
    withRepo(c, async (id) => {
      if (c.req.query("fetch") === "1") {
        // A failed fetch (offline, auth) is not fatal: fall through and describe what we
        // already have, so the preview degrades to "as of the last sync" instead of erroring.
        try {
          await fetchRepo(id);
        } catch {
          /* best-effort */
        }
      }
      return c.json(await getIncoming(id));
    }),
  );
}
