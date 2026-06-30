# RepoYeti — Working TODO

> **The single list to work off of — ordered by urgency, not by topic.** It absorbed the two earlier
> planning docs (a release-readiness audit + a 5-lens feature gap analysis); this pass re-cut them by
> priority and removed the overlap, so each item appears exactly once.
>
> **Tiers.** 🔴 **Vital / do now** — blocks a public release, or is a real bug / active breakage (≈P0).
> 🟡 **Big deal** — needed for a polished public reputation (≈P1). 🟢 **Small deal** — polish /
> nice-to-have (≈P2). 🧑 **Needs you** — a decision or secret only the owner can supply (some of these
> also gate the release). 🤖 = an agent can do it. Each item keeps its original code (`A4`, `C1`, `D1`…)
> so older cross-references still resolve. Status verified against the tree on **2026-06-30** (HEAD `fddae3b`).

> **▶ RESUME HERE (next session — use ONE chat).** Tree is **clean and `tsc`-green**; the big `src/`
> reorg + agent surfaces have all **landed** (see the 2026-06-30 wave below). **Next agent-doable item:
> the per-file-staging WEB UI** — the backend route `POST /api/repos/:id/commit-selected` already
> exists (commit `fddae3b`, `commitSelectedRepo` + 3 tests + OpenAPI entry); what's left is the
> dashboard: add per-file **selection** (checkboxes) to `ChangesTree.vue`, a "Commit selected (N)"
> affordance in `RepoCard.vue`, the `store`/`api` wiring (`api.commitSelected`), then browser-verify.
> After that: **`D1`** RepoCard split → **`E6`** frontend test infra.
>
> ⚠️ **Run ONE agent session at a time** (the owner's standing rule — item **G**): this cycle two
> sessions on one tree collided (a refactor landed mid-edit and broke `tsc`); avoid that by working in
> a single chat. **Constraints:** work **only on `main`** (never branch); **never** suggest
> pushing/tagging/branch-protecting `0.1.0` (owner-only — don't raise it). The gitignored `.env` holds
> `CONNECTIONS_API_KEY` + the Groq key — don't re-ask.
>
> 🗺️ **New backend layout (post-reorg — old `daemon.ts`/`service.ts` paths in this doc are stale):**
> HTTP routes live in `src/http/routes/*` (registered via `register(app, deps)`; composition root
> `src/http/app.ts`); the read layer is `src/read/{status,inspect,diffstat}.ts`; the orchestration
> layer is `src/service/*` (barrel `src/service/index.ts`); CLI in `src/cli/`, MCP in `src/mcp/`. The
> **pattern to copy for a new route:** schema in `src/schemas.ts` → service fn in `src/service/*` →
> route in `src/http/routes/*` → **add it to the OpenAPI map in `src/http/openapi.ts`** (a drift-guard
> test fails otherwise) → a route test. A dev daemon must be **restarted after backend edits** (or run
> under `bun run dev`'s `--watch`); it's single-instance on `:7171`.

---

## ✅ Landed in the `0.1.0` burndown (2026-06-29 → 06-30, all on `main`)

All verified green at each step (**318 daemon tests** + web build, `tsc`, `check:codes`/`check:boundaries`, lint).

**🔧 Maintainability reorg + agent surfaces (2026-06-30) — DONE.** A run of commits landed on top of the
frontend pass:
- **3-part structural reorg** (`5b77e9b`/`e4eb817`/`00ee787`): read layer → `src/read/`, `service.ts`
  split into `src/service/*`, `daemon.ts` split into `src/http/` (composition root + per-area route
  modules), CLI entry → `src/cli/`. _Most `service.ts`/`daemon.ts` path references lower in this doc are
  now stale — see the new-layout map in the RESUME banner._
- **`feat(openapi)`** (`d240b96`): machine-readable OpenAPI 3.1 at `GET /api/openapi.json`, with a
  drift-guard test asserting every `/api/*` route appears in `src/http/openapi.ts`.
- **`feat(cli)`** (`ba2fa78`): git verbs that drive the running daemon over HTTP.
- **`feat(mcp)`** (`c4483d0`): a hand-rolled MCP server (stdio + `/api/mcp`) exposing the git tools to AI
  agents.
- **`feat(auth)`** (`7a6db83`): an **opt-in** Bearer API token for remote/headless agents (off by default).
- **`feat(log)`** (`e9640a9`): merge-commit detection (`parents` + `isMerge`) + a `?merges` filter.
- **tunnel-URL UI** (`904856e` backend + `9bab202` web): Settings → Access "Stable address" card; redacted
  `tunnel` on `/api/status` + keychain-backed `PUT /api/tunnel`, live tunnel restart when remote is on.
- **per-file staging — BACKEND** (`fddae3b`): `POST /api/repos/:id/commit-selected` + `commitSelectedRepo`
  (reuses the `commitGroups` primitive; stale-selection guard) + 3 route tests + OpenAPI entry. _The
  dashboard UI to drive it is the next item — see 🟡 below._

**🟡 Lore feature-parity port — DONE & verified end-to-end** against a live `loreserver` 0.8.4 (the
`lore` CLI is now installed at `~/bin`). AI commit-diff, smart-commit (plan input + group staging via
`lore stage`+`lore commit`), and content-search (JS scan) all routed through `VcsBackend` and re-enabled
in the Lore UI (`aiHere`). New gated `tests/lore-parity.test.ts`. **`F5` DONE** — `MARCHING_ORDERS.md`
promoted to `ARCHITECTURE.md`, all refs repointed.

**🔴 Vital — ALL DONE:** `C1` (registerRepo → `detectVcs`), `C2` (file diff + discard routed through
`VcsBackend` — `filePatch`/`discardFile` + `fileModels` capability), `E4` (PUT /api/mode toggle +
watcher→SSE delivery tests), `A6` (shim retired — docs corrected, no deploy needed; see finding below).

**🟡/🟢 also done:** `A4` (version cut `0.1.0` — **tag not pushed**, owner pulls that trigger), `A5`
(baked-in OAuth documented as intentional + override path), `F2` (CF-header auth comment + README proxy
note), `E5` (headless in-memory keychain stub + legacy-rehome coverage), `C5` (gate-nesting comment),
`D2` (`requireId()` collapses ~20 route guards), `D3` (CommitStyle drift guard), `D4` (centralize
`ok`/`fail`/`PATCH_CAP`), `D5` (drop `workspace_id`), `B4` (CI OS matrix + `bun audit`), `B5` (pre-commit
lint+typecheck), `B7` (pin `@types/bun`, Monaco chunk limit).

**Connections / A6 owner-step finding:** the `cnx_live_…` key is valid with `apps:write`, but the
RepoYeti app (`a790090c…`) is an **AEGIS-direct registration** with no Studio filing-queue row, so the
`studio.connections.icu` API can't see/PATCH it. Per `docs/REMOTE_ACCESS.md` the redirect URIs were
already set in AEGIS via the vault. No write was made; the only unproven step is a **live sign-in**
with the daemon running (owner step). (Key is now stored in gitignored `.env` as `CONNECTIONS_API_KEY`.)

**Frontend pass — in progress** (dev env: daemon `:7171` + Vite + `loreserver`, verified via browser
preview tools). **DONE & browser-verified:** toast-undo (hide/pin/star → Undo restores) · AI-style picker
(Settings → AI; change → daemon persists `style`) · **Lore servers UI** (Settings → "Lore servers" panel
add/remove → daemon persists; Add-repo → "From Lore" tab cloned `clonetest` from a live server end-to-end).
**`F6` a11y DONE** (header role=button + keyboard + chip aria-labels, verified). **commit-detail diff DONE** (tap a History commit → changed files + diff; new readCommit on VcsBackend + route, git verified, Lore degrades gracefully). **tunnel-URL UI DONE** (Settings → Access "Stable address" card: redacted `tunnel` on `/api/status` + a keychain-backed `PUT /api/tunnel`, live tunnel restart when remote is on; 6 route tests; commits `904856e` backend + `9bab202` web). Remaining: **per-file-staging WEB UI** (backend `fddae3b` done — see 🟡), then `D1` RepoCard split (biggest), and `E6` test infra.

**Still open:**
- **`E6`** frontend test infra (Vitest + Playwright) — adds dev-deps to the shared `bun.lock`.
- **PAT/HTTPS:** the network path can't be unit-verified without a real private repo + token (owner).
- **🧑 owner:** branch-protect `main`, confirm MIT, push the `v0.1.0` tag, the live sign-in.

**SDK migration — DONE (owner decided: do it now).** ALL text-scraped Lore reads — status, changed
files, branches, log — now go through `@lore-vcs/sdk` (a koffi native-FFI binding) in `src/vcs/lore-sdk.ts`,
returning structured/typed data (drift-proof; the `lore` CLI has **no** machine-readable output). Lazy-loaded
(a git-only daemon never touches the native lib) with the CLI parsers retained as fallback. Single binary
preserved: `build.ts` keeps the SDK + koffi EXTERNAL to `--compile` and bundles the native libs into
`dist/node_modules` (CLI fallback if absent); compiled `repoyeti.exe` boots clean. koffi in
`trustedDependencies`. Verified end-to-end vs a live `loreserver` 0.8.4 (`lore-parity.test.ts`). _Remaining
SDK-adjacent: the `lore diff`-based reads (file patch / AI diff) still use the CLI — left as-is since `lore
diff` is real unified-diff content, not drift-prone status labels._

---

## 🔴 Vital — do now (blocks a public release / real bugs / active breakage)

**No agent-doable blockers remain in this tier** (`C1`/`C2`/`E4` are done). The release is gated only by
**owner** steps: `A6` (a live sign-in), plus the items under **🧑 Needs you** (version cut `A4`, README
infra decision `A5`, branch protection).

- [ ] **🧑 `A6` — auth shim RETIRED; only an owner live sign-in remains to verify.** Superseded: the
  rotating-URL Worker shim is **gone** — `src/config.ts` + the IdP now use the daemon's own
  `https://app.repoyeti.com/oauth/callback` (the stable named CF tunnel) + the loopback, so there's no
  worker to deploy or re-register. Per the Connections finding below + project memory, redirect URIs were
  set in AEGIS via the vault. **The single unproven step is a real owner sign-in** (open
  `app.repoyeti.com` with the daemon running → "Sign in with Connections" → confirm the owner is claimed).
  Agent can't do this — it needs your live Connections login. ⚠️ Still entangled with `A5` (the README/
  config infra decision), below.
- [x] **🤖 `C1` / `C2` / `E4` — ALL DONE** (see the Landed section): `C1` registerRepo→`detectVcs`;
  `C2` `filePatch`/`discardFile` on `VcsBackend`; `E4` `PUT /api/mode` toggle + watcher→SSE delivery test.
  No agent work remains in the 🔴 Vital tier — only the owner-gated `A6` below + the 🧑 release items.

## 🟡 Big deal — before a polished public launch (P1)

- [ ] **🤖 `D1` — decompose `RepoCard.vue` (~1,382 lines). The #1 remaining maintainability win.** ~8 UI
  concerns in one file. Extract `BranchPanel` / `StashPanel` / `LogPanel` / `TagPanel` / `RemoteManager` /
  `FileViewerDrawer` siblings; `RepoCard` becomes a thin composer. Do it incrementally **on `main`** (the
  owner's work-only-on-main rule; one session at a time). _Note: the **backend** reorg already happened
  (`daemon.ts`→`src/http/`, `service.ts`→`src/service/*`); `D1` is now the **frontend** counterpart._
- [x] **🤖 `E5` — DONE** (see Landed): headless in-memory keychain stub so the migration path runs in CI +
  legacy `"gitmob"`-service rehome coverage.
- [ ] **🤖 `E6` — frontend tests: currently zero.** Add **Vitest + @vue/test-utils** (pure-lib units, a
  store smoke test, a `SmartCommitPlan.vue` render) + one Playwright E2E of the SSE flow.
  ⛔ *Needs new dev-deps in the shared `bun.lock` — coordinate before adding.*
- [x] **🤖 `F2` — DONE** (see Landed): loud `isRemoteRequest()` code comment + a README note on the
  Cloudflare-header (local-vs-remote) auth assumption behind a non-Cloudflare proxy.
- [x] **🤖 `F6` — DONE** (see Landed): card header → `role=button` + keyboard, status chips got
  `aria-label`s, touch-target pass — verified.
- [ ] **🤖 PAT / HTTPS auth.** Unblocks clone/fetch/push/tag-push for **private HTTPS** remotes (SSH-key
  auth doesn't help there). `pat_handle` column reserved; needs keychain + per-op `GIT_ASKPASS`. ⚠️ The
  network path can't be unit-verified without a real private repo + token — needs owner involvement to test.
- [ ] **🤖 Per-file (file-level) staging — WEB UI remaining** *(this is the next item; backend DONE in
  `fddae3b`)*. The route `POST /api/repos/:id/commit-selected` (+ `commitSelectedRepo`, stale-selection
  guard, 3 tests, OpenAPI entry) already exists and is usable by the CLI/MCP today. What's left is the
  dashboard: per-file **selection** (checkboxes) in `ChangesTree.vue` (currently only emits `discard`), a
  "Commit selected (N)" affordance in `RepoCard.vue`, the `store`/`api.commitSelected` wiring, then a
  browser pass.

### Lore (the pivot — experimental, behind `REPOYETI_LORE=1`)

The core is done + verified (see ✅ Already done). To reach git-parity:

- [ ] **🤖 Port the remaining git-only features to Lore.** Diff + discard are ported (`lore diff` /
  `lore reset --purge`, verified); **AI commit-diff** (`collectRepoDiff`/`collectRepoPathsDiff`),
  **smart-commit** group staging, and **content-search** are still git-only and are **hidden in the Lore
  UI** (the web `aiHere` + capability gates). Map them to `lore diff` / `lore stage <paths>`+`lore commit`
  / a JS content scan over changed files, then re-enable the gates. (Shares the `C2` cleanup above.)
- [x] **🤖 Lore servers web UI — DONE** (see Landed): Settings → "Lore servers" panel (add/remove →
  daemon persists) + an Add-repo "From Lore" tab; clone-from-server verified end-to-end against a live
  `loreserver`. ⚠️ Reminder for any new server URL: prefer an **IP literal over `localhost`** — a
  `localhost`→IPv6 QUIC handshake stalls ~30 s before IPv4 fallback (ops cap at 120 s via `LORE_TIMEOUT_MS`).

## 🟢 Small deal — polish / nice-to-have (P2)

**Cleanup & dedup + Tooling — ALL DONE** (see the "🟡/🟢 also done" line in Landed):
- [x] `C5` gate-nesting comment · `D2` `requireId()` route-guard collapse · `D3` `CommitStyle` drift
  guard (the `check:codes` test) · `D4` centralized `ok`/`fail`/`PATCH_CAP` · `D5` dropped `workspace_id`.
- [x] `B4` CI OS matrix + `bun audit` · `B5` pre-commit lint+typecheck · `B7` pinned `@types/bun` + Monaco
  `chunkSizeWarningLimit`.
- [ ] *Tiny optional sliver of `D4` not pursued:* a shared `boundedDiffWithFallback()` (the unborn-HEAD
  diff fallback is still copy-pasted across ~3 collectors). Low value; skip unless touching that code.

**Features (occasional / niche)**
- [x] **DONE — commit-detail diff · toast "Undo" (hide/pin/star) · stable named-tunnel URL (the "Stable
  address" Settings card) · AI commit-style picker · Lore SDK read-migration.** All landed (see the Landed
  section + the 2026-06-30 wave); kept here only so old cross-refs resolve.
- [ ] **🤖 Niche, someday:** git blame / per-file history · compare two refs · per-repo AI-provider override
  · cross-repo search · cross-repo activity feed · web-push notifications · commit signing (SSH/GPG).
- *Workspace/grouping UI is intentionally deferred — the `workspaces` table was removed.*

## 🧑 Needs you (decisions & secrets — collect answers, then an agent can act)

- [ ] **`A4` — cut version `0.1.0`** *(release-gating)*. Bump `package.json` (both) `0.0.1 → 0.1.0`, move
  CHANGELOG `[Unreleased]` into a dated `[0.1.0]` section, tag `v0.1.0`. You pick the number; the rest is
  mechanical.
- [ ] **`A5` — README personal-infra decision** *(release-gating)*. The README + `src/config.ts` hardcode
  *your* infra — the `https://app.repoyeti.com/oauth/callback` redirect (your named CF tunnel) + a shared
  Connections `client_id` — and assume `connections.icu` access, so a forker would authenticate against
  *your* setup. Decide: keep baked-in / move to a neutral domain / require each deployer to register their
  own app. **Unblocked by your in-progress Connections-MCP/DNS work.** Then a 1-line README/config edit.
  *(This is also the only remaining piece of `F4`.)*
- [ ] **Branch-protect `main` at launch** *(release-gating)*. Require PRs + green CI; no direct pushes — a
  GitHub settings step once the repo is public.
- [ ] **`F5` — relocate the root design doc.** `MARCHING_ORDERS.md` still sits at root; it holds durable
  spec (the §7 security model, secrets/identity protocol, §10 acceptance criteria) and is live-linked from
  `README.md`, `shim/README.md`, and `docs/SMART_COMMIT.md`. Promote its durable architecture into an
  `ARCHITECTURE.md`, **or** move it to `docs/archive/` and fix those three links. (The three input briefs —
  `gem.md`, `gpt.md`, `git-orchestrator-brief-v2.md` — were already deleted.)
- [ ] **Confirm the `MIT` license** is the intended one (package.json + `LICENSE` already say MIT).
- [ ] **Adopt "one branch/worktree per agent session"** (G) as the standing process (you run multiple
  agents on one tree; this avoids the cross-session contention seen this cycle).

## 🚫 Rejected by design (do **not** implement — don't re-litigate)

Interactive merge-conflict UI · rebase · `reset --hard` · `push --force`/`--force-with-lease` ·
WebSockets transport · self-hosted relay/tunnel infra · hunk-level partial staging. Each can strand the
repo in an unsafe state on a phone, or contradicts the zero-infra positioning.

## ✅ Already done / decided (so it isn't re-done)

- **`A1` — Groq key: DECIDED, do not rotate.** Owner directive (do not re-raise): the built-in `gsk_…` is a
  free-tier throwaway (6000 TPM, graceful heuristic fallback when exceeded) and **may be shipped publicly
  for the first few testers on purpose** — explicitly **not** a release blocker. Invariant: the real key
  stays in the gitignored `.env` as `GITMOB_BUILTIN_GROQ_KEY`; `src/config.ts` keeps only the placeholder.
- **`F4` — README accuracy pass** *(done 2026-06-29)*: feature list, status note, Smart-Commit/Lore/servers/
  remote-sync, `bun test` line, stale i18n claim, "Run (Phase 1)" heading all fixed. Only the owner-gated
  `A5` infra URLs remain (see 🧑 Needs you).
- **GitMob→RepoYeti rename** (commit `7fd3d39`, 2026-06-29): landed tree-wide and verified (bun test
  258/258, `tsc` clean, `check:codes`/`check:boundaries`, web build all green) — package + `bin` + CLI,
  `GITMOB_*`→`REPOYETI_*` env (incl. `REPOYETI_LORE`), `~/.gitmob`→`~/.repoyeti` & `gitmob.db`→`repoyeti.db`,
  keychain service + health/single-instance identity, the `misc/GitMob.*` files, and the **GitHub repo**
  `LunarWerxs/gitmob`→`LunarWerxs/repoyeti` (remote + package URLs repointed; old URL auto-redirects).
  Back-compat shipped: `config.ts migrateLegacyState()` (one-time dir + db move, default-home only) and
  `secrets.ts getSecret()` legacy-`"gitmob"`-keychain fallback (re-homes on first read). *The only remaining
  rename loose-end is an owner live sign-in to confirm remote auth — tracked as `A6` above (the old Worker
  shim was retired, not redeployed).*
- **Guardrails:** Biome lint + `bun run check` + boundary guard + ApiErrorCode drift guard + 80% coverage
  gate, all in CI · `release.yml` (tag → cross-OS binary + GitHub Release) · pinned Bun + dep cache ·
  auto-enabled git hooks · `.editorconfig`.
- **Architecture:** `ActionResult`/`ActionCode` in `contract.ts`; `cloneLoreRepo` wired to a route;
  `src/paths.ts`/`asResult` dedup; `sessions`/`workspaces` tables removed.
- **Tests:** detached-HEAD (`E1`), push errors (`E2`), SSE/bus (`E3`).
- **Docs/community:** `LICENSE`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, issue/PR templates,
  `dependabot.yml`; `package.json` metadata (license/repo/author/keywords/engines); the three superseded
  root briefs deleted.
- **Lore (experimental, `REPOYETI_LORE=1`):** web card adapts to `repo.vcs` (a `lore` badge · hides
  fetch/stash/remotes/tags · relabels pull→"Sync"); **file diff + discard ported** (`lore diff` /
  `lore reset --purge`); **servers-registry backend + `cloneLoreRepo`**; **server round-trip
  (commit/push/sync) + clone-from-server verified** against a live local `loreserver`. The Lore CLI command
  surface + the status/branches/log output parsers were verified against **lore 0.8.4** (parsers
  fixture-locked in `tests/lore-parse.test.ts`); the ~30 s `localhost`-QUIC stall is dodged by using an IP
  literal in the server URL.
