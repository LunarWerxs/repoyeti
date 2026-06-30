# RepoYeti — Working TODO

> **The single list to work off of.** This is the consolidated working list — it absorbed the two
> earlier planning docs (a release-readiness audit and a 5-lens feature gap analysis), which were
> removed once their open items landed here.
>
> **Legend.** `P0` blocks a public release · `P1` blocks a polished reputation · `P2` polish.
> 🧑 needs you (a secret/decision) · 🤖 an agent can do it. Status verified against the tree
> on **2026-06-29** — already-done items are listed under §6 so they don't get re-done.

---

## 1. Release gate (P0) — must be true before `main` goes public

- [x] **🧑 Groq key — DECIDED: do not rotate** (A1). Owner directive (do not re-raise): the built-in `gsk_…` is a free-tier throwaway (6000 TPM, graceful heuristic fallback when exceeded) and **may be shipped publicly for the first few testers on purpose** — so it is explicitly **not** a release blocker. The only invariant: the real key stays in the gitignored `.env` as `GITMOB_BUILTIN_GROQ_KEY`; `src/config.ts` keeps only the placeholder. No rotation, no code change.
- [ ] **🧑+🤖 Cut version `0.1.0`** (A4). Bump `package.json` (both) `0.0.1 → 0.1.0`, move CHANGELOG `[Unreleased]` into a dated `[0.1.0]` section, tag `v0.1.0`. (Owner picks the number; the rest is mechanical.)
- [ ] **🧑 README personal-infra decision** (A5). The README + `src/config.ts` hardcode a personal OAuth shim (`repoyeti-auth.lunawerx.workers.dev`) and a shared Connections `client_id`, and assume `connections.icu` access — a forker would hit *your* shim. Decide: keep baked-in / move to a neutral domain / require each deployer to register their own app. **Unblocked by your in-progress Connections-MCP/DNS work.** Then a 1-line README/config edit. *(Deploy/re-register mechanics live in A6.)*
- [ ] **🧑+🤖 Deploy the renamed auth shim + re-register its redirect URI** (A6 — *new, the rename's only loose end*). The GitMob→RepoYeti rename repointed the OAuth shim to `repoyeti-auth.lunawerx.workers.dev`, but **that worker is not deployed** (confirmed 404) and the old `gitmob-auth` URL is still what's registered at `connections.icu`. **Until both land, remote sign-in is broken** (local-only mode is unaffected). Steps: **(1) 🧑** authenticate wrangler — `bunx wrangler login` (browser → Allow) *or* set `CLOUDFLARE_API_TOKEN`; an agent **cannot** log in for you. **(2) 🤖** `cd shim && bunx wrangler deploy`, then curl `…/cb` to confirm it's live. **(3) 🧑** in the `studio.connections.icu` developer app (clientId `a790090c…`, unchanged), set/add redirect URI `https://repoyeti-auth.lunawerx.workers.dev/cb` (scopes `openid profile email`) — **no API/connector exists**, it's a dashboard edit behind your login. **(4) 🤖** fix the README + `shim/README.md` "✅ Deployed" wording (it's aspirational until step 2). Then delete the stale `gitmob-auth` worker. ⚠️ **Overlaps A5:** if A5 chooses a neutral domain, deploy *that* instead of `repoyeti-auth`.
- [ ] **🤖 Close the P1 architecture gaps** (C1, C2) and **the P1 test gap** (E4) — the public-release gate requires C1 + C2 + E1–E4 closed (E1–E3 are already done).
- [ ] **🧑 Branch-protect `main`** at launch (require PRs + green CI; no direct pushes) — a GitHub settings step once the repo is public.

## 2. Architecture correctness (P1–P2)

- [ ] **🤖 P1 — `registerRepo` is git-only** (C1). `service.ts` hardcodes an `existsSync('.git')` check, so "Point to Folder" silently rejects valid **Lore** repos. Fix: use `detectVcs(p)` (exists in `src/vcs/index.ts`); return `NOT_A_REPO` when null. *Real bug given the Lore pivot.*
- [ ] **🤖 P1 — finish the VcsBackend abstraction** (C2). `service.ts` imports `loreFilePatch`/`loreDiscardFile` directly from `vcs/lore.ts` and branches on `repo.vcs` in the viewer + `discardFile`. Add `filePatch()` + `discardFile()` to the `VcsBackend` interface, implement in `git.ts` + `lore.ts`, route through `backend.*`.
- [ ] **🤖 P2 — gate nesting** (C5). `collectRepoDiff` / `planCommitInput` call `readStatus` (takes `readGate`) *inside* an `enqueue` slot — no deadlock, but holds the op-queue while waiting on a read slot. Read before `enqueue`, or add a comment that it's intentional.

## 3. Decomposition & dedup (P1–P2)

- [ ] **🤖 P1 — decompose `RepoCard.vue` (1,382 lines)** (D1). ~8 UI concerns in one file. Extract `BranchPanel` / `StashPanel` / `LogPanel` / `TagPanel` / `RemoteManager` / `FileViewerDrawer` siblings; `RepoCard` becomes a thin composer. Do incrementally, on its own branch. **The #1 maintainability win.**
- [ ] **🤖 P2 — `repoRoute()` wrapper** (D2). `daemon.ts` repeats the id-parse/guard pattern ~19×. Extend the existing `action()`/`repoFromPath()` factory pattern.
- [ ] **🤖 P2 — type duplication** (D3). `CommitStyle` defined twice (config.ts + web types.ts); `CommitPlanGroup` (backend) vs `CommitGroup` (frontend) name drift. Align names; extend the `check-error-codes` drift guard to cover them.
- [ ] **🤖 P2 — residual dedup** (D4). Confirm/remove any remaining `ok()` / `PATCH_CAP` duplication between `git-actions.ts` and `vcs/lore.ts`; consider a shared `boundedDiffWithFallback()` (the unborn-HEAD diff fallback is copy-pasted in ~3 collectors). (`src/paths.ts` + `asResult()` dedup already done.)
- [ ] **🤖 P2 — drop the dead `workspace_id` column** (D5). The `repos` table still has `workspace_id` with no SQL against it (the `workspaces`/`sessions` tables were already removed).

## 4. Tests (P1)

- [ ] **🤖 P1 — tunnel toggle + watcher→SSE pipeline** (E4). The cloudflared *resolver* (`tunnel.test.ts`) and watcher *health* (`watcher.test.ts`) are covered, but the `PUT /api/mode` start/stop toggle and the watcher→`broadcast`→SSE wiring are not. Mock the tunnel factory; write a file and assert a `repo_state_changed` event reaches a subscriber. (E1 detached-HEAD, E2 push errors, E3 SSE/bus are **done**.)
- [ ] **🤖 P1 — secrets without a keychain** (E5). 2 of 3 `secrets.test.ts` cases `skipIf(!keychain)` → never run in CI. Add a stub so the migration path runs headlessly. **Now also cover the new legacy keychain-service fallback** (`getSecret()` reads the old `"gitmob"` service and re-homes the value under `"repoyeti"` on first access — added by the rename, currently untested).
- [ ] **🤖 P1 — frontend tests: zero** (E6). Add **Vitest + @vue/test-utils** (pure-lib units, a store smoke test, a `SmartCommitPlan.vue` render) + one Playwright E2E of the SSE flow. ⛔ *Needs new dev-deps in the shared `bun.lock` — coordinate before adding.*

## 5. Tooling & docs polish (P1–P2)

- [ ] **🤖 P1 — document the Cloudflare-header auth assumption** (F2). `isRemoteRequest()` decides local-vs-remote purely from `cf-connecting-ip`/`x-forwarded-*`; behind a non-Cloudflare proxy that omits them, *remote could be treated as local*. Add a loud code comment + a README deployment note.
- [x] **🤖 P1 — README accuracy pass** (F4). *Done 2026-06-29:* feature list, status note, Smart-Commit/Lore/servers/remote-sync, `bun test` line, stale i18n claim, "Run (Phase 1)" heading all fixed. **Remaining inside F4: the owner-gated A5 infra URLs.**
- [ ] **🧑 P1 — relocate the root design doc** (F5). The three input briefs (`gem.md`, `gpt.md`, `git-orchestrator-brief-v2.md`) were **deleted** once their content was verified absorbed into `MARCHING_ORDERS.md`. `MARCHING_ORDERS.md` itself still sits at root — it holds durable spec (the §7 security model, secrets/identity protocol, §10 acceptance criteria) and is live-linked from `README.md`, `shim/README.md`, and `docs/SMART_COMMIT.md`. To tidy: promote its durable architecture into an `ARCHITECTURE.md`, **or** move it to `docs/archive/` and fix those three links. (This `TODO.md` is now the roadmap — link it from the README.)
- [ ] **🤖 P1–P2 — accessibility / touch-target pass** (F6). Card header is a `div` with `@click` (not a button); status chips lack `aria-label`; check 44pt/48dp targets. CSS/markup pass before a public, phone-first launch.
- [ ] **🤖 P2 — CI completeness** (B4 remainder). Add a cross-platform OS matrix (the compiled binary is per-OS) + a `bun audit` step. (Bun pinned + dep cache + the `check`/coverage/release workflows already in CI.)
- [ ] **🤖 P2 — broaden the pre-commit hook** (B5 remainder) to run lint + typecheck, not just `i18n:check` (lint already runs in CI, so minor).
- [ ] **🤖 P2 — misc hygiene** (B7 remainder): pin `@types/bun` (currently `latest`); set `build.chunkSizeWarningLimit` for the Monaco chunk.

## 6. Feature backlog (Tier-2 — none are blockers)

Highest value first.

**Lore (the pivot — experimental, behind `REPOYETI_LORE=1`):** the core is done + verified (see §9). Remaining:

- [ ] **🤖 P2 — Lore servers web UI.** The backend is done + verified (`config.servers` + `GET/POST/DELETE /api/servers` + `POST /api/servers/clone` → `cloneLoreRepo`), but **nothing in `web/src` calls `/api/servers`** — there is no UI yet. Add a Settings → Servers panel (add/remove server URLs) + a "Clone from a Lore server" path in the Add-repo dialog. ⚠️ Prefer an **IP literal over `localhost`** in server URLs — a `localhost`→IPv6 QUIC handshake stalls ~30 s before IPv4 fallback (the Lore backend caps each op at 120 s via `LORE_TIMEOUT_MS`). *(The CHANGELOG "Server registry" entry is API-only until this lands.)*
- [ ] **🤖 P2 — port the remaining git-only features to Lore.** Diff + discard are ported (`lore diff` / `lore reset --purge`, verified); **AI commit-diff** (`collectRepoDiff`/`collectRepoPathsDiff`), **smart-commit** group staging, and **content-search** are still git-only and are **hidden in the Lore UI** (the web `aiHere` + capability gates). Map them to `lore diff` / `lore stage <paths>`+`lore commit` / a JS content scan over changed files, then re-enable the gates. (Related cleanup is `C2`: fold `filePatch`/`discardFile` into the `VcsBackend` interface instead of branching on `repo.vcs` in `service.ts`.)
- [ ] **🤖 P2 — migrate Lore reads off CLI-scraping → `@lore-vcs/sdk`.** Status/branches/log are parsed from `lore` text output (fixture-locked in `tests/lore-parse.test.ts`); the SDK returns structured data that won't drift across Lore 0.x releases. Optional hardening.

- [ ] **P1 — PAT / HTTPS auth.** Unblocks clone/fetch/push/tag-push for **private HTTPS** remotes (SSH-key auth doesn't help there). `pat_handle` column reserved; needs keychain + per-op `GIT_ASKPASS`. ⚠️ The network path can't be unit-verified without a real private repo + token — needs owner involvement to test.
- [ ] **P1 — per-file (file-level) staging.** Only stage-all exists for a normal commit. (Smart Commit already stages file-level internally; this exposes it for a single ordinary commit.)
- [ ] **P1 — accessibility pass** (same as F6 above).
- [ ] **P2 — commit-detail diff from the log.** Tap a commit in History → see its changed files + diff (multi-file `git show`; add `readCommit` to `VcsBackend` so it's VCS-agnostic).
- [ ] **P2 — toast "Undo" for hide / pin / star.** Pure frontend (vue-sonner action); zero server change.
- [ ] **P2 — stable named-tunnel URL surface.** `CF_TUNNEL_TOKEN` is supported in config; add a Settings UI for it (no more re-scan on restart).
- [ ] **P2 — AI commit-style picker in the UI** (Conventional / concise / detailed; currently config.json-only).
- [ ] **P2 — git blame / per-file history · compare two refs · per-repo AI-provider override · cross-repo search · cross-repo activity feed · web-push notifications · commit signing (SSH/GPG).** All occasional/niche; see the analysis doc.
- *Workspace/grouping UI is now intentionally deferred — the `workspaces` table was removed.*

## 7. Rejected by design (do **not** implement — don't re-litigate)

Interactive merge-conflict UI · rebase · `reset --hard` · `push --force`/`--force-with-lease` ·
WebSockets transport · self-hosted relay/tunnel infra · hunk-level partial staging. Each can strand
the repo in an unsafe state on a phone, or contradicts the zero-infra positioning.

## 8. Owner decisions queued (collect answers, then I can act)

- Final version number (A4) · is `connections.icu` public or internal, and keep/replace the baked-in OAuth shim + `client_id` (A5) · MIT confirmed · move the root planning docs (F5) · "one branch/worktree per agent session" as the standing process (G). *(Groq-key rotation (A1) is decided — do not rotate; see §1.)*

## 9. Already done (so it isn't re-done)

**Rename (commit `7fd3d39`, 2026-06-29):** the full **GitMob→RepoYeti** rename landed tree-wide and is
verified (bun test 258/258, `tsc` clean, `check:codes`/`check:boundaries`, web build all green) — package +
`bin` + CLI, `GITMOB_*`→`REPOYETI_*` env (incl. `REPOYETI_LORE`), `~/.gitmob`→`~/.repoyeti` & `gitmob.db`→
`repoyeti.db`, keychain service + health/single-instance identity, the `misc/GitMob.*` files, and the
**GitHub repo** `LunarWerxs/gitmob`→`LunarWerxs/repoyeti` (remote + package URLs repointed; old URL auto-redirects).
Back-compat shipped: `config.ts migrateLegacyState()` (one-time dir + db move, default-home only) and
`secrets.ts getSecret()` legacy-`"gitmob"`-keychain fallback (re-homes on first read). *The only remaining
rename work is the owner-gated shim deploy + redirect-URI re-register — tracked as §1 A6.*

Guardrails: Biome lint + `bun run check` + boundary guard + ApiErrorCode drift guard + 80% coverage
gate, all in CI · `release.yml` (tag → cross-OS binary + GitHub Release) · pinned Bun + dep cache ·
auto-enabled git hooks · `.editorconfig`. Architecture: `ActionResult`/`ActionCode` in `contract.ts`;
`cloneLoreRepo` wired to a route; `src/paths.ts`/`asResult` dedup; `sessions`/`workspaces` tables
removed. Tests: detached-HEAD (E1), push errors (E2), SSE/bus (E3). Docs/community: `LICENSE`,
`SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, issue/PR templates, `dependabot.yml`;
`package.json` metadata (license/repo/author/keywords/engines). README accuracy pass (this session).
**Lore (experimental, `REPOYETI_LORE=1`):** web card adapts to `repo.vcs` (a `lore` badge · hides
fetch/stash/remotes/tags · relabels pull→"Sync"); **file diff + discard ported** (`lore diff` /
`lore reset --purge`); **servers-registry backend + `cloneLoreRepo`**; **server round-trip
(commit/push/sync) + clone-from-server verified** against a live local `loreserver`. The Lore CLI
command surface + the status/branches/log output parsers were verified against **lore 0.8.4**
(parsers fixture-locked in `tests/lore-parse.test.ts`); the ~30 s `localhost`-QUIC stall is dodged
by using an IP literal in the server URL.
