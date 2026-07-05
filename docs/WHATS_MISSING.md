# What's Missing — the actionable roadmap across the four apps

**RepoYeti · DevWebUI · Reimagine (→ RēDesign) · QuickDictate** — researched 2026-07-04 · every item re-verified against code 2026-07-05

> **Provenance & trust level:** born as a 16-agent research audit (2026-07-04: per app — codebase read,
> competitive field research, candidate features, adversarial judge). On 2026-07-05 a 12-agent
> verification pass re-checked every surviving item and factual claim against the actual code and swept
> each codebase for real work the feature audit skipped (half-built code, bugs, security gaps, untracked
> maintenance). Everything below is **verified open as of 2026-07-05** — finished items were retired,
> stale premises corrected in place, and every new hygiene item survived an adversarial judge with
> file:line evidence.

---

## TL;DR — if you build ONE thing per app

| App | Build this first | Why |
|---|---|---|
| **RepoYeti** | **Agent Safety Rail** — mutating MCP calls require a human approve/deny | The 2026 fear is "what did my AI agent just push?" — nobody else has the daemon+identity+MCP combo to gate it. All prereqs verified in place; the gate itself is zero code today |
| **DevWebUI** | **Close the CORS hole, then Incident Autopilot** | A security fix jumped the queue: any open browser tab can currently shut down the daemon (details below). Then `diagnose(process)` turns table-stakes MCP into an expert system |
| **Reimagine → RēDesign** | **Run Cost Meter** — live $ estimate per fan-out, before you hit Run | Lands on the market's rawest nerve (credit-drain rage at Bolt/Lovable/v0); per-call usage capture is already shipped — only the pricing table + UI is missing |
| **QuickDictate** | **Fix the two trust bugs, then Per-App Profiles** | Clipboard clobber + transcript-logging leak undermine the privacy pitch today. Profiles stay the top feature — but it's greenfield (no focus-detection hook exists; the audit's "hook already exists in output.rs" was wrong) |

Through-line unchanged: **the wow in 2026 is agent-native + trust features, not more UI.** The
2026-07-05 sweep reinforced it from the inside — the most urgent new items are all trust repairs
(CORS hole, clipboard clobber, transcript logging, key-file permissions).

---

## RepoYeti

**What it is:** the always-on multi-repo git dashboard — auto-discovery, live status over SSE, safe ops
through a per-repo queue (ff-only, no-force), AI commits, tunnel + Connections OIDC, MCP server,
phone-reachable.

### Features (verified open)

- [x] **⭐ Agent Safety Rail** *(M — DONE 2026-07-05: gate at the single MCP choke point (both transports), SSE approval cards with countdown, 120s auto-deny, settings toggle; dashboard actions structurally ungated; 20 tests)* — any MUTATES-tagged MCP call from a headless agent (Claude Code
      etc.) blocks pending a one-tap human approve/deny; read-only calls pass through. **Verified:** the
      prereqs all exist (`readOnly` tagging on the 6 mutating tools in `src/mcp/tools.ts`, per-repo queue
      in `src/opqueue.ts`, identity, tunnel) but the tag is never read anywhere — the gate is zero code.
      v1: approval cards in the already-open dashboard via SSE + a short auto-deny timeout so agents never
      hang; skip phone push (no push infra exists — confirmed).
- [x] **Identity Firewall** *(S — DONE 2026-07-05: path-pattern → required-identity rules, hard block at all 3 service call sites (MCP inherits), red repo badge + Settings editor; no rules = zero behavior change; 20 tests)* — upgrade multi-identity from passive selection to enforced policy:
      "this repo may only ever push as work-identity" → hard block + red banner + MCP rejection.
      **Verified:** `resolveRepoIdentity` picks credentials on every commit/push path but nothing compares
      against a required identity — the enforcement layer is entirely absent. Keep v1 dead simple
      (path-pattern → required identity).
- [x] **Conflict Concierge — re-scoped** *(S — DONE 2026-07-05: persistent state-driven triage card, per-session dismiss, click-through; E2E-verified live against a real conflicted repo)* — the original premise is stale: conflicted/mid-op repos
      are **no longer silently skipped**. `repo_auto_commit_blocked` SSE events + a warning toast already
      ship (`src/auto-commit.ts:124-292` → `web/src/store/settings.ts:552`). Remaining work: upgrade the
      transient toast to a persistent "3 repos need you" triage card with per-repo files/branches —
      triage, not resolution (the "no merge UI" non-goal stands).
- [x] **`triage_briefing` MCP tool** *(S — DONE 2026-07-05: readOnly tool in both stdio+HTTP adapters; conflicted/drifted/autoCommitBlocked/dirty groups)* — one structured "what needs attention across all repos" call
      for agents (conflicts + blocked auto-commits + behind). The `drift` tool already covers
      ahead/behind; extend from there. Natural bundle with the Safety Rail.

### Hygiene & debt (new — 2026-07-05 sweep)

- [x] **Sync auto-push covers only the theme** *(S — DONE 2026-07-05: silent debounced watcher over all 12 PREF_KEYS, mirrors the theme watcher's guards; 6 store tests)* — only `themeMode` has a debounce-push watcher
      (`web/src/store/settings.ts:439`); none of the 12 allowlisted `PREF_KEYS` setters push after a
      change, so device B sees nothing until a manual "Sync Now" — violating the feature's own spec
      (`docs/CONNECTIONS_SETTINGS_SYNC.md`: "on save, debounce and push"). Wire the remaining setters the
      same way theme already works.
- [x] **Cloud-sync has zero tests** *(M — DONE 2026-07-05: 19 connections-sync tests + 13 sync-route tests against a mocked Connections server; full suite 388 pass / 0 fail)* — `src/connections-sync.ts` (token refresh-on-401, rotation,
      allowlist filtering, enable/disable/forget lifecycle) and `src/http/routes/sync.ts` have no coverage,
      unlike every comparable route module in `tests/`. This is live auth/token code — test it before it
      calcifies.
- [x] **Docs-path fixup pass** *(S)* — done 2026-07-05: fixed the `README.md` links, the
      `src/connections-sync.ts` / `src/config.ts` header comments, plus five more bare `ARCHITECTURE.md`
      references found in the sweep (`shim/worker.ts`, `src/auth.ts`, `src/config.ts:33`,
      `src/cli/lifecycle.ts` error string, `src/http/app.ts`). All now carry the `docs/` prefix.

### Done since the audit — don't re-plan

- **Auto-commit × Smart-Commit fusion** — shipped end-to-end: opt-in per repo and globally, drives the
  Smart Commit splitter through the same guarded service calls, SSE audit feed → toast. The audit listed
  it as "worth doing"; it's done.

### Decided against — don't re-litigate

- Standalone cross-device push notifications (no push infra; build notification plumbing only for
  approvals + conflicts). Constellation Command Palette (suite-level L-effort coordination bet, not
  RepoYeti's roadmap).

---

## DevWebUI

**What it is:** the dev-server control plane — projects from `.devwebui` files, machine scan, lifecycle
with graceful stops, guided port takeover, CPU/mem monitoring, runtime switching, VS Code task takeover,
MCP + CLI + GUI as equal clients of one daemon.

### Fix first (security — 2026-07-05 sweep)

- [x] **Close the wildcard-CORS / token-less shutdown hole** *(S — DONE 2026-07-05: origin allowlist + a 403 Origin-check middleware on all mutating routes — closes the simple-request CSRF gap CORS alone can't; 4 new tests)* — `app.use("/api/*", cors())`
      (`server/src/http/index.ts:15`) allows all origins, and `POST /api/shutdown` accepts the
      `x-devwebui-shutdown-source: ui` header with no token at all (`core.ts:139`). Any website open in
      any browser tab can `fetch()` the local daemon cross-origin: shut it down, stop/restart managed
      processes, hit clone/browse-folder routes. This is *not* the killed tunnel idea — it's same-machine,
      any-tab exposure that exists today. Fix: restrict CORS to the daemon's own origin, or require a
      signal a cross-origin page can't forge.

### Features (verified open)

- [x] **⭐ MCP-Native Incident Autopilot** *(M — DONE 2026-07-05: pure diagnose() engine with exactly 3 heuristics + honest 'unknown' fallback, GET /api/processes/:id/diagnose, diagnose_process as the 18th MCP tool, log-tail evidence; 16 tests + live-daemon smoke)* — a composite
      `diagnose(process)` MCP tool: correlate crash logs + port conflicts + exit codes into a structured
      root-cause guess plus an executable remediation. **Verified:** `mcp.ts` is still pure 1:1 CRUD
      (17 thin wrappers), but the raw signals are further along than the audit assumed — `errors.ts`
      already dedupes and persists error records to `~/.devwebui/errors.ndjson`, and `portOwners()`
      exists. Ship v1 with exactly 3 hardcoded heuristics (port-in-use, non-zero exit vs a small
      known-error table, missing script) — no rules engine.
- [x] **Time-Travel Log Vault** *(S — DONE 2026-07-05: rotating per-process files under ~/.devwebui/logs (1MB × 2 rotations), crash sidecar survives restarts, last-crash stderr tail surfaced on next start via response + SSE + GUI toast, logfile tail route; 14 tests)* — process logs are still in-memory only (500-line cap, gone on
      restart). Add rotating per-process files under `~/.devwebui/logs/` + the killer detail: on the next
      start attempt, proactively show the last crash's stderr tail. Note: `errors.ndjson` persistence
      exists but is a deduped summary, not raw logs — the crash-tail-on-start moment is still unbuilt.
      Resist building mini-Elasticsearch.
- [x] **Dependency-ordered startup** *(S — DONE 2026-07-05: manual `waitForPort` (port or sibling id), topological start order + cycle detection, "waiting" status in GUI, TCP-poll only; 16 tests)* — manual declaration only ("wait for that
      process's port"), one readiness check via the existing `isPortListening()` TCP probe. No HTTP
      probes, no env-var auto-inference (it *will* misfire exactly where trust matters).
- [x] **Port-takeover residual** *(S — DONE 2026-07-05: cmdline + uptime captured on Windows/unix, shown in the confirm toast; smoke-tested live)* — the guided free-port flow shipped since the audit (PID + name +
      managed-vs-stray + confirm, wired end-to-end); the remaining polish is capturing and showing
      **cmdline + uptime** in `portOwners()`. (The old blind `freePort()` sweep survives only behind the
      explicit "free port on start" toggle — intentional.)

### Hygiene & debt (new — 2026-07-05 sweep)

- [x] **README is stale on MCP** *(S — DONE 2026-07-05: mcp-stdio.mjs engine credited, full 17-tool list)* — still claims the dropped `@modelcontextprotocol/sdk` dependency
      (replaced by the shared `mcp-stdio.mjs` engine) and lists 12 of the 17 shipped tools —
      `enable_process`/`disable_process`/`enable_project`/`disable_project`/`take_over_autostart` are
      invisible to anyone reading the README.
- [x] **Windows FFI metrics path has zero CI** *(M — DONE 2026-07-05: 3-OS CI matrix added; the windows-latest leg now runs the launcher self-test + suite via the existing skipIf guards. Nice-to-have left: a dedicated FFI struct-offset unit test)* — CI runs ubuntu-only and its own trailing comment
      flags the missing `windows-latest` matrix leg. `server/src/metrics.ts` does raw Win32 struct-offset
      parsing that would regress silently (wrong CPU/mem numbers in the field, no CI failure).
- [x] **DEV-ONLY tray item is untracked** *(S — DONE 2026-07-05: Rebuild & Restart now only exists when DEVWEBUI_DEV=1 or a source tree is present; self-test still passes)* — `misc/DevWebUI-Tray.ps1:285` self-flags "remove before
      public distribution" (Rebuild & Restart assumes bun + source are present), but nothing tracks it.
      Remove or dev-gate it before any non-developer distribution.

### Decided against — don't re-litigate

- One-click remote access/tunnel (`connections.ts` documents no auth gate by design; internet-exposing a
  process-killing daemon is a security product, not a sprint — the CORS fix above is same-machine hygiene
  and does not reopen this). Fleet health score/daily digest (fold "restarted 4× overnight, likely OOM"
  into Autopilot's output). Constellation Bridge deep links.

---

## Reimagine → RēDesign

**What it is:** screenshot → parallel fan-out across many models (self-healing key pools, vision captions
so text-only models can "see") → sandboxed gallery of single-file HTML reimaginings. UI, CLI, and MCP
share one daemon.

> **Stack note (2026-07-05):** Reimagine's backend is still Node/CJS on raw `node:http` — the odd one
> out. A planned **Bun + TS + Hono conversion** brings it onto the RepoYeti/DevWebUI stack; tracked as a
> ⭐ item under **Cross-cutting** below, full plan in
> [`Reimagine/docs/BUN_TS_MIGRATION.md`](../../../NEWProjects/active/Reimagine/docs/BUN_TS_MIGRATION.md).

### Rename: Reimagine → RēDesign (decided 2026-07-05)

The macron can't live in machine names (GitHub repo names are ASCII-only, and lowercase-ASCII package/
binary/env names avoid a lifetime of encoding friction), so the name has exactly **three forms — never
mix them up**:

| Form | Where it's used |
|---|---|
| **RēDesign** (ē = U+0113) | Everything a human reads: UI strings, doc/README titles, About, Connections display label |
| **`redesign`** (lowercase ASCII) | Everything a machine reads: package name, binary, CLI command, `REDESIGN_*` env vars, MCP server name, release asset names (`redesign-linux-x64` …) |
| **ReDesign** (ASCII prose fallback) | Where prose must be ASCII: the GitHub repo name, URLs, filenames — and once in README prose so the name stays greppable/searchable without the macron |

- [x] **Prong 1 — display rename** *(S — DONE 2026-07-05: web UI titles/i18n strings, CLI + boot banner "RēDesign", README title "RēDesign (ReDesign)")* — swap user-visible strings to "RēDesign": Vue
      `document.title` + header/app-title strings, README and docs titles (keep an ASCII "(ReDesign)"
      alias on first mention), CLI `--help` banner, the Connections app *display label* (the client_id
      itself does not change).
- [x] **Prong 2 — identifier rename** *(S–M — DONE 2026-07-05 with the migration: package/bin/binary `redesign`, `redesign-*` release assets, `REDESIGN_*` env vars, MCP serverInfo `redesign`; data paths untouched. Left for the owner: the GitHub repo rename Reimagine → ReDesign, and the optional local folder rename)* —
      `package.json` name → `redesign`, binary + release assets (`redesign.exe`, `redesign-linux-x64` …),
      any `REIMAGINE_*` env vars / `reimagine`-named data paths or storage keys (with a one-time fallback
      read of the old names so users' runs/settings aren't stranded), MCP server name, GitHub repo rename
      `Reimagine` → `ReDesign` (GitHub auto-redirects the old URLs). Optional last step: the local folder
      `D:\NEWProjects\active\Reimagine` — many docs/notes reference that path, so update them in the same
      pass or skip the folder rename entirely.

### Features (verified open)

- [x] **⭐ Run Cost Meter** *(S — DONE 2026-07-05: per-job/run cost, pre-run "≈ $X" estimate, live run total, history costs, spend-to-date + "prices last updated" in the key sheet; 19 tests + live mock-run verification. Pricing.json now holds REAL prices (all 6 models, estimate:false) pulled from LiteLLM's public pricing catalog with OpenRouter fallback — refresh anytime with `bun run update-pricing` (21 offline tests cover the converter). That script IS the "prices last updated" maintenance commitment)* — per-call usage capture is confirmed shipped (`src/runner/reimagine.js`
      persists `usage` per job from all three provider response shapes); zero pricing/cost code exists.
      Add a config-driven pricing table, "this 6-model × 8-prompt run ≈ $X" *before* Run, actuals per run
      in history, spend-to-date in the key sheet. Hard requirement stands: show "prices last updated
      <date>" — stale numbers destroy the trust the feature exists to build.
- [ ] **Cross-App Idea Locker ("Send to Reimagine")** *(M — premise corrected)* — the audit's "fully
      unblocked" was oversold: what's live in all three apps is **settings/appearance-only** sync on a
      locker client that is explicitly "NOT blob storage" with a 64KB document cap. The feature needs a
      second document type, a real answer for screenshot payloads (pointer/thumbnail, not base64 blobs in
      the sync doc), and idempotent imports. Still worth building; just don't scope it as UI wiring.
      Rider: prompt-preset sync as a third document type on the same rail.
- [x] **Agent-Native Batch Reimagine** *(S — DONE 2026-07-05: `batch_reimagine` MCP tool, wait:false → runIds, wait:true → full digest with per-job captions; verified via a live stdio JSON-RPC session over all 6 sample inputs)* — every primitive already exists
      (`run` accepts input/prompt selection strings, captions are stored per job, `get_run` returns the
      full manifest); only the composite MCP "recipe" tool (folder of screenshots + preset in → structured
      manifest + caption summaries out) is missing.
- [x] **Rolling star tally** *(S — DONE 2026-07-05: first-star-per-run persisted to localStorage, capped 20 runs, readout in the Viewer status section)* — the head-to-head star UI exists per-run, but stars don't survive the
      run (pruned in `viewer.ts:72`). "Starred first in 13 of your last 20 runs" needs cross-run
      persistence first. Keep it a tally, not a leaderboard.

### Hygiene & debt (new — 2026-07-05 sweep)

- [x] **`.env` written without 0600** *(S — DONE 2026-07-05 as a migration rider: `.env` writer + generic `writeJSON()` both 0o600 now)* — `src/server/settings.js:136` writes the one file holding
      every provider's plaintext API keys with default permissions, while `src/connections.js:50` already
      sets `mode: 0o600` for its own refresh token. Match that precedent there and in `src/util.js`'s
      generic `writeJSON()`.
- [x] **Connections OIDC/sync has zero tests** *(M — DONE 2026-07-05: connections.js/updater.js converted to typed ESM (zero require() left in src/), 23 tests against a fake Connections server; PKCE/refresh/rotation/forget all covered)* — `src/connections.js` (PKCE, token
      refresh/rotation, push/pull merge, `disable(forget)`) and its sync routes (now
      `src/http/routes/connections.ts` post-migration) have no coverage. *(Post-migration note:
      `connections.js` and `updater.js` are the last two CJS files — convert to TS and test in one
      pass; RepoYeti's new FakeConnectionsServer test pattern is the template.)*
- [x] **Undo-toast for `deleteRun` was never actually tracked** *(S — DONE 2026-07-05: 6s optimistic undo window before the API call, sendBeacon flush on tab close)* — the audit called
      "styled-dialogs/undo-toast" tracked maintenance, but only styled-dialogs had a ticket (done).
      `src/store.js:284` still `rmSync`s a run's outputs irrecoverably the instant confirm is clicked —
      add a few-second snackbar undo window (vue-sonner is already in use).

### Done since the audit — don't re-plan

- **Styled dialogs** — native `window.confirm`/`alert` fully replaced by kit AlertDialog/Dialog + unified
  toasts across store actions.

### Decided against — don't re-litigate

- Tunnel + mobile viewer (the daemon holds live provider keys; if mobile review ever matters, a same-LAN
  responsive pass gets it free). Persistent win-rate leaderboard (solo-user volume makes the stats noise —
  the rolling tally above is the reframe).

---

## QuickDictate

**What it is:** the native Rust tray dictation app — pre-warmed mic, global hotkeys that survive
sleep/RDP, six BYOK STT providers behind one trait with self-healing key pools, hybrid
keystroke/clipboard paste, dev-aware text pipeline. Deliberately airgapped: no account, no telemetry, no
server in the path.

### Fix first (trust bugs — 2026-07-05 sweep)

- [x] **Clipboard paste clobbers the user's clipboard** *(S — DONE 2026-07-05: prior text saved before EmptyClipboard, restored after the settle delay; non-text formats documented as unrestorable)* — anything over 80 chars (most real
      sentences) goes through `paste_via_clipboard` (`src/output.rs:191`), which empties and overwrites
      the clipboard and never restores it. A just-copied password/snippet/link is silently gone. Save the
      prior contents before `EmptyClipboard`, restore after the Ctrl+V settles.
- [x] **`enable_logging` writes full transcripts to plaintext** *(S — DONE 2026-07-05: default logs are char-count-only; new opt-in `log_transcripts` flag + settings checkbox; README/SECURITY caveated)* — `src/stt/mod.rs:581,585` log the
      complete dictated text at info level into a non-rotating `quickdictate.log` whenever the documented
      debug toggle (or `QUICKDICTATE_LOG`) is on — while README and SECURITY.md say "no transcripts are
      collected" with no caveat. Redact transcript text from logs (or gate it behind its own explicit
      opt-in) and caveat the docs. This is the app's core trust promise.
- [x] **Dead config flags in the user-facing template** *(S — DONE 2026-07-05: both removed; old user settings.json files still parse)* — `voice_activation` and `bulk_insert` ship
      in `settings.example.json` (which the README walks users through) and are read nowhere; toggling
      them is a no-op. Wire them up or strip them.

### Features (verified open)

- [x] **⭐ Per-App Profiles** *(M — DONE 2026-07-05: new focus.rs Win32 detection (all failures degrade to global settings), first-match-wins profiles with extend/replace replacement modes, processor cache, read-only settings card, README schema docs; provider override explicitly deferred; no profiles = byte-identical behavior, test-proven)* — auto-switch replacement
      tables, punctuation, even preferred provider by focused app (VS Code/terminal keeps dev-casing and
      kills auto-punctuation; Slack/Outlook does the reverse). **The audit's claim that "the hook already
      exists in output.rs" is wrong** — pasting targets the OS-focused window implicitly; no
      focus-resolution code exists anywhere in the app. Real scope: Win32 foreground-window/exe detection
      + per-profile config schema + switch logic. Still the top feature (the single highest-frequency
      daily annoyance) — just don't budget it as "hook exists."
- [x] **Transcript History + Undo Stack** *(S — DONE 2026-07-05: rolling 50-entry timestamped history + "Recent transcriptions" tray submenu with click-to-repaste; most-recent re-paste unchanged)* — confirmed: `last_transcription` is a single
      `Mutex<Option<String>>` slot (`src/state.rs:51`). Generalize to a rolling timestamped history with
      re-paste. Cheapest real feature on the list, and the substrate Voice Commands needs.
- [x] **Voice Commands, precision subset** *(M — DONE 2026-07-05: "scratch that" only (end-of-utterance, word-boundary-safe, off by default), backspace-undo of exactly the last chunk via TranscriptHistory; the pause-gated punctuation set stays DEFERRED by design)* — v1 = "scratch that" (undo last chunk) + a
      small pause-gated set of unambiguous punctuation words. Depends on the history stack above. Market
      it as "undo without touching the mouse," not as Talon.
- [ ] **Connections settings/dictionary sync** *(quiet retention plumbing, not a headline)* — spec'd for
      exactly this app's shape in `docs/CONNECTIONS_SETTINGS_SYNC.md` (§4d loopback OAuth + §5f raw store
      contract); confirmed not wired yet. **API keys stay local-only, never synced** — that *is* the
      trust story.

### Decided against — don't re-litigate

- MCP dictation surface (the hotkey already types into a terminal running Claude Code — one paragraph of
  docs instead of a server). Phone-as-remote-mic via tunnel (a different product; no demonstrated
  demand). **Persisting key-health across restarts** — removed from this roadmap: `src/keys.rs` documents
  an explicit owner decision (2026-07-04) that health lives in RAM only, fresh every launch; the audit's
  "cheap half" suggestion contradicts it.

---

## Cross-cutting

- [x] **Linux/Mac builds for the three web apps** *(S — WIRED 2026-07-05: DevWebUI got 3-OS ci.yml + release.yml (`devwebui-*` assets); RēDesign got both as migration Phase 6 (`redesign-*` assets); RepoYeti already had them. Remaining acceptance: first green Actions run, which needs an owner push)* — RepoYeti,
      DevWebUI, and (post-conversion) Reimagine are all Bun+Vue with no native addons, so they build for
      Linux/macOS via **host-native matrix compile** — each OS runner runs a bare `bun build --compile`
      (no `--target`), exactly as RepoYeti already does. The CI matrix doubles as the test rig for OSes we
      don't own: it runs the suite on `ubuntu`/`macos` on every push (the substitute for local testing).
      Status: **RepoYeti done** (3-OS `ci.yml` + `release.yml` shipping `linux-x64`/`macos-arm64`/`windows-x64.exe`);
      **DevWebUI** build script is release-ready but has **no `release.yml`** and an ubuntu-only CI — copy
      RepoYeti's two workflows, rename assets `devwebui-*`, add the `macos`/`windows` CI legs; **Reimagine**
      has no `.github` at all — lands as Phase 6 of its conversion below. No app code changes needed.
- [x] **⭐ Reimagine → Bun + TS + Hono** *(L — DONE 2026-07-05: all 7 phases executed and verified with runtime evidence — typecheck clean, 66 bun tests green, daemon + compiled `dist/redesign.exe` + MCP stdio handshake all booted live; `.env` 0600 and `redesign` naming riders landed. Leftovers: `connections.js`/`updater.js` still CJS-bridged — see RēDesign hygiene)* — bring Reimagine's backend onto the
      same stack as RepoYeti/DevWebUI (its Vue/Vite/TS web is already there; this is server-side only). It's
      closer than it looks: **zero runtime npm deps** (Bun-native built-ins + `fetch`), the kit engines
      (`mcp-stdio`/`connections-locker`/`updater-engine`) are already vendored, MCP+CLI already match the
      sibling pattern, and `bun --compile` already ships a working binary today. Real work = rewrite the one
      raw-`http` hand-rolled router (`src/server.js`, ~30 routes) into Hono `http/routes/*`, a mechanical
      CJS→ESM+TS pass over ~24 files, and restructure the custom 521-line `run-tests.js` into `bun test`.
      Full phased plan + route map + preserve-list + release YAML: **[`Reimagine/docs/BUN_TS_MIGRATION.md`](../../../NEWProjects/active/Reimagine/docs/BUN_TS_MIGRATION.md)**.
      (Rider: fold in the `.env` 0600 fix — see Reimagine hygiene — while touching `server/settings.js`.
      Second rider: the **Reimagine → RēDesign identifier rename** — prong 2 in the Reimagine section —
      lands in this same window, so machine names churn exactly once.)
- [ ] **QuickDictate stays Windows-only** *(decided)* — its core (cpal/eframe/tokio/STT) is portable, but
      the input/output/UI layer is 100% Win32 with zero `cfg` gating (global hotkeys, keystroke/clipboard
      injection, tray+overlay, autostart) — a 3–6-week rewrite per OS, with Wayland an open question. Not
      worth it; not on the roadmap.
- [ ] **Owner, 5 minutes: the cross-machine sync test** — sign into Connections in any app on two
      machines, flip the theme, watch it land. The only untested layer of settings-sync across all three
      JS apps (everything else is runtime-verified).
- [ ] **Shared "needs-a-human" primitive in the kit** — RepoYeti's approval cards + conflict triage and
      DevWebUI's crash summaries are the same shape: an event bus of "a human must look at this,"
      surfaced over SSE in an already-open tab first, push notifications later if ever. Build it once, in
      the kit, when the second consumer lands.

Principles the judges kept proving (condensed):

1. **The constellation wins where it's invisible** — cross-app *plumbing* (locker payloads, preset sync,
   settings sync) survived judging; cross-app *UI* (command palettes, deep links) died.
2. **Agent-native is the defensible frontier** — Safety Rail, Incident Autopilot, and Batch Reimagine all
   build *judgment* on top of MCP surfaces rivals expose as raw CRUD; one daemon + three equal clients is
   the architectural head start.
3. **Trust/transparency features punch above their weight** — and the 2026-07-05 sweep found the same
   theme pointing inward: the most urgent new items are trust repairs (CORS hole, clipboard clobber,
   transcript logging, key-file permissions).
4. **Network exposure is scope creep** — three separate tunnel/remote ideas died the same death; RepoYeti
   is the only app where that work is already done (vault + OIDC + named tunnel).

---

*History: 16-agent research audit 2026-07-04 (28 candidates, adversarial judging). 12-agent verification +
gap sweep 2026-07-05 — every item and factual claim re-checked against code with file:line evidence;
finished items retired (auto-commit fusion, styled dialogs, most of guided port takeover); stale premises
corrected (QuickDictate's output.rs "hook", RepoYeti's "silently skipped" conflicts, Reimagine's "fully
unblocked" locker); one item removed for contradicting an owner decision (QuickDictate key-health
persistence); 14 judge-confirmed hygiene/debt items added.*
