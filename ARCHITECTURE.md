# RepoYeti — Architecture & Build Spec

> _(Formerly `MARCHING_ORDERS.md` — promoted to the durable architecture doc; the §-numbered
> security model, secrets/identity protocol, and acceptance criteria below remain the source of truth.)_
>
> **What this file is.** The single, decisive build spec for the **smallest version that
> actually works end-to-end on a phone**. It distilled three earlier input briefs — a
> hard-constraints architecture brief, an opinion prompt, and a Gemini "winning stack"
> response — into one source of truth; those briefs were removed once their content was
> fully absorbed here. Decisions below are made, not surveyed. Where the briefs left
> something OPEN, it is now closed. Where they over-scoped, it is now cut.
>
> Method note: this spec was produced by running three independent minimal-MVP designs
> (speed lens / security-first lens / simplest-stack lens) and adversarially synthesizing them.
> Every "locked" decision below survived all three.

> **✅ Implementation status (built & verified).** Phases 1–5 are implemented in `src/` + `web/` and
> verified at runtime (see [README.md](README.md)). Two deliberate deviations from the plan below:
> (1) **stage-all + commit from the phone is now IN v1** (the §3 "OUT" deferral is lifted — it's atomic
> and can't create the half-merged state the guards prevent), and **register/create repo are built**;
> (2) **PAT/HTTPS-token auth + OS-keychain (keytar)** stay deferred (SSH-key injection covers the common
> case), and **Phase 6 (Tauri tray)** is deferred — the CLI binary + phone browser is the whole product.
> The only thing between "built" and a live remote login is the owner-gated §13 setup (register the
> OAuth app + set the owner sub). **The redirect shim is already deployed** at
> `https://repoyeti-auth.lunawerx.workers.dev` and git is initialized with tests (`bun test`, 19 passing).

---

## 0. The one thesis

**RepoYeti is a single Bun-compiled daemon binary.** It discovers your git repos, watches them
cheaply, serves a mobile PWA, drives git operations with per-operation identity injection, and
exposes itself over a zero-config Cloudflare tunnel — gated by app-layer auth so the tunnel URL
alone is worthless. **The CLI binary + a phone browser is the entire product.** The Tauri tray,
named tunnels, TOTP, workspaces UI, and on-phone staging are all deferred — none of them are on
the path to a working demo, and the tray in particular can be added later **without touching a
single line of daemon code.**

The sharpest cut: **defer Tauri.** It is launch convenience, not functionality.

---

## 1. What we're building

A self-contained, lightweight, system-wide remote git manager. A background daemon on a dev
machine (Mac / Windows / Linux) that:

- recursively discovers all git repos under chosen root(s),
- tracks each repo's state (branch, dirty count, ahead / behind, remote, errors) **event-driven, not polled**,
- manages multiple git identities (personal / work / client — name + email + SSH key + optional PAT),
- exposes a high-density, dark, mobile-first **PWA dashboard** over a **secure zero-config remote URL**,
- and lets you trigger **safe** git actions (fetch / pull / push / assign-identity / register / create) from the phone.

It is **not** a mobile IDE. No diff viewer, no merge-conflict resolution, no rebase. The product
is *passive triage + identity-boundary protection*: know your repos' state from anywhere, and
never push with the wrong identity.

### The one success loop (this is "fully functional")

```
repoyeti start  →  phone (on LTE) opens the URL  →  "Sign in with Connections" once  →
see all repos live  →  assign an identity to a repo  →  pull/push with that identity  →
state updates on the phone within seconds
```

If that loop works over HTTPS from a cellular connection with no port forwarding, v1 is done.

---

## 2. Locked stack

| Layer | Decision | Why it won |
|---|---|---|
| **Runtime** | **Bun (LTS)** | `bun --compile` → single self-contained binary; built-in `bun:sqlite` kills the `better-sqlite3` native-addon build churn on Windows; built-in HTTP server + file watchers; TS-first, no `tsc` step. |
| **Git engine** | **`simple-git`** over the system `git` binary | Reuses the user's installed, optimized git. Its per-call `env` option maps *directly* onto `GIT_SSH_COMMAND` / `GIT_AUTHOR_*` injection. No JS git reimplementation to trust. |
| **HTTP framework** | **Hono** | Tiny, TS-native. Its middleware model makes auth **structural** — a single `app.use()` gates the whole router, so you *cannot* add an unauthenticated route by accident. |
| **Storage** | **`bun:sqlite`**, WAL mode, `synchronous=NORMAL` | Only store that survives concurrent writers (watcher + API + git ops). One file: `repoyeti.db`. Retry on `SQLITE_BUSY`; fall back to `journal_mode=DELETE` if WAL won't open (Windows AV). |
| **Tunnel** | **`cloudflared` quick tunnel** (free, rotating) **+ a fixed redirect shim** | Daemon stays zero-config on a free auto tunnel; a tiny **stable shim** (Cloudflare Worker `*.workers.dev` — recommended — or Pages / GitHub Pages) is the registered OAuth redirect and bounces login back to the daemon's current URL (§7). No domain, no ngrok. Tunnel client bundled as a pinned binary. A stable *dashboard* URL comes later, once you own a domain. |
| **Auth** | **"Sign in with Connections"** — public OIDC (AEGIS) at `accounts.connections.icu`; daemon verifies the login token and trusts one owner `sub` | Stand-alone relying party using connections.icu's **public** OAuth — like "Log in with Google." No shared secret, no Connections-repo coupling, no homegrown password/PIN. See §7. |
| **Transport / sync** | **SSE** daemon→phone, **REST** phone→daemon | v2 decided this. SSE auto-reconnects through cloudflared with no WebSocket upgrade; maps cleanly onto the event-driven watcher. Commands are request/response → REST. |
| **Frontend** | **Vue 3 + Vite**, PWA, **embedded in the binary**; **import pre-built libraries, minimal hand-written UI** | Static files bundled at `bun --compile` time; daemon serves them — no second server. **Owner directive: lean on smart pre-built libs, write minimal UI to maintain.** Stack: **reka-ui** (shadcn-vue–style component kit, `src/components/ui/`) · **Tailwind v4** (`@tailwindcss/vite`) · **@vueuse/core** (composables — `useEventSource` handles SSE+reconnect, `useColorMode`, `useLocalStorage`) · **@formkit/auto-animate** (zero-config list/card transitions — solves "no layout shift on SSE updates" for free) · **@lucide/vue** icons · **vue-sonner** toasts · **Pinia** state · **vite-plugin-pwa** (auto manifest + service worker). |
| **Secrets** | **OS keychain via `keytar`** | SSH key *paths* in SQLite (the daemon never reads key bytes — only passes the path to `ssh -i`). Git PATs, the owner's Connections OAuth tokens, and any confidential `client_secret` in keychain by handle, resolved at call time. |
| **Packaging** | `bun --compile` per platform, shipped via **npm** | `npm install -g repoyeti && repoyeti start`. ~25–35 MB incl. embedded frontend + bundled cloudflared. Tauri tray deferred to Phase 6. |

---

## 3. Scope

### IN (v1 — required for the success loop)

- **Discovery:** recursive BFS from **one** configured root, max depth 6, skip `node_modules`,
  nested `.git`, and common build dirs; cap at **200 repos** on Linux (inotify budget). `source=auto`.
- **Manual targeting:** `POST /api/repos/register` (existing absolute path, `source=pinned`) and
  `POST /api/repos/create` (`mkdir` + `git init`, `source=created`).
- **Watchers:** one watcher per repo on **`.git/HEAD` and `.git/index` only** — never the working
  tree. On event → recompute that repo's status → write SQLite → emit SSE.
- **Per-repo operation queue:** a `Map<repoId, Promise>` chain serializing *all* git ops on a repo.
  This is a **Phase 1 architectural primitive**, not a later optimization — it is what prevents the
  forbidden mid-merge race.
- **Status:** branch, dirty count, **ahead (local)**, **behind (from last fetch only, timestamped)**,
  remote URL — via `git status --porcelain`, `git rev-parse`, `git rev-list @{u}..HEAD`.
- **SSE:** `GET /api/events` streaming `repo_state_changed` + `daemon_status`; session-gated; client
  uses `EventSource` (auto-reconnect).
- **REST git actions:** fetch, **pull (fast-forward only, dirty-tree preflight)**, **push (no `--force`,
  non-FF guard)**. All behind the operation queue and the conflict guard.
- **Identity:** CRUD identities (name, email, SSH key path, optional PAT-by-handle); assign to repo;
  **per-operation injection** (see §7).
- **Auth:** "Sign in with Connections" (public OIDC, see §7); every route 401s until the caller has logged in as the trusted owner.
- **Tunnel:** cloudflared quick tunnel spawned as a child process; URL printed + emitted via SSE;
  **tunnel failure is non-fatal** (daemon keeps serving localhost).
- **PWA:** flat repo list sorted by name; per-repo card = branch badge + dirty count + ahead/behind
  (with fetch timestamp) + identity selector + fetch/pull/push buttons; dark terminal theme;
  Add-to-Home-Screen manifest.
- **CLI:** `repoyeti start | stop | status | add-root <path> | set-owner <sub|email>` (`set-owner` sets the trusted Connections identity; OAuth `client_id`/redirect come from config — see §13). _Since v1 the CLI has grown beyond lifecycle: it now also has **git verbs** (`repos`/`status <repo>`/`log`/`branches`/`branch`/`checkout`/`commit`/`diff`/`drift`/`stash`/`push`/`pull`/`fetch`) that drive the running daemon over its loopback HTTP API, plus **`repoyeti mcp`** (an MCP stdio server for AI agents) and **`repoyeti token`** (mint/revoke the optional API token). See the new "Agent & CLI surfaces" note under §4._
- **Robustness:** port-conflict auto-increment; 30s op timeout; structured error codes.

### OUT (explicitly deferred — do not build in v1)

| Deferred | When | Why it's safe to cut |
|---|---|---|
| Tauri system-tray app | Phase 6 | CLI binary delivers the full loop; tray is a thin sidecar launcher added with **zero daemon changes**. |
| **Stage / commit from phone** | Phase 5 patch | Highest-risk mobile UX surface. Pull/push of *pre-staged* commits covers ~90% of remote use. |
| Workspaces grouping UI | Phase 5 | `workspaces` table exists in schema (for future identity inheritance); v1 UI is a flat list. |
| Named Cloudflare tunnel (stable URL) | Phase 5 | One-flag config upgrade (`CF_TUNNEL_TOKEN`); quick tunnel is fine for the demo loop. |
| TOTP second factor | n/a | The connections.icu identity (Cognito, behind the owner's own MFA) already satisfies the auth non-negotiable. |
| PAT / HTTPS remote auth | Phase 5 | SSH-key injection covers GitHub/GitLab/Bitbucket; HTTPS-PAT via `GIT_ASKPASS` is a separate path. |
| Multi-root discovery | Phase 5 | One root (`~/code`, `~/Projects`) covers the common case. |
| Session-management UI / per-device revoke | Phase 5 | A "sign out everywhere" clears daemon sessions; the Connections login itself is governed by AEGIS. v1 has a single owner session. |
| Commit signing (GPG/SSH) | post-v1 | Schema slot reserved, not wired. |
| Diff viewer · merge-conflict UI · rebase · `reset --hard` · `push --force` | **never** | Out of scope by design. Daemon surfaces "resolve at your desk" and stops. |
| SVN / Mercurial · cloud-synced accounts · auto-updater · native installers | post-v1 | Not on the path. |
| WebSockets | **never** | SSE is strictly sufficient; enforce this against drift. |
| Self-hosted frp/bore/chisel relay | **never** | Converts "self-contained tool" into "infra operator" — contradicts the whole point. |

---

## 4. Architecture

```
┌──────────────────────── repoyeti daemon (single Bun binary) ────────────────────────┐
│                                                                                    │
│  Discovery (BFS, depth≤6)──┐                                                        │
│                            ▼                                                        │
│  Watchers (.git/HEAD, .git/index per repo) ──► Status engine (simple-git) ──┐      │
│                                                          │                   ▼      │
│                                                  per-repo OP QUEUE      bun:sqlite  │
│                                                  Map<repoId,Promise>    (WAL)       │
│                                                          │                   │      │
│  Hono HTTP server (127.0.0.1:PORT)                       │                   │      │
│   ├─ OIDC session middleware (Sign in with Connections; owner-sub check) ◄┘   │      │
│   ├─ REST: /api/repos, /api/identities, /api/repos/:id/{fetch,pull,push,…}  │      │
│   ├─ SSE:  /api/events  ◄─────────────── emits on status change ────────────┘      │
│   └─ static: embedded Vue 3 PWA                                                     │
│                            │                                                        │
│  Secrets ──► OS keychain (keytar): owner Connections tokens, PATs, client_secret?  │
│             (SSH key paths in DB)  ──► OAuth @ accounts.connections.icu (OIDC)      │
│                            │                                                        │
│  cloudflared child process ─────► https://xxxx.trycloudflare.com (HTTPS edge)      │
└────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                  📱 phone PWA (daemon session cookie after Connections login)
```

**Data flow, both directions:**
- *State (server→phone):* file change on `.git/index` → watcher fires → op-queue runs status read →
  SQLite updated → SSE `repo_state_changed` pushed → PWA patches that one card (no full re-render).
- *Commands (phone→daemon):* PWA `POST`s a REST action with `Authorization: Bearer <jwt>` → auth
  middleware verifies → op-queue serializes the git call → conflict guard preflights → `simple-git`
  runs with injected identity → result returned + SSE follow-up.

### Agent & CLI surfaces (one orchestration core, several front doors)

There are now **three** ways to reach the same git operations — the HTTP routes, the CLI verbs, and
the MCP tools — and they all funnel into the **one service orchestration layer** (`src/service/`),
so every guard (op-queue serialization, FF-only pull, no-force push, dirty-tree refusal, identity
injection) holds no matter which door a request comes through. The layering:

- **HTTP routes** (`src/http/routes/*`) — the canonical surface; the PWA and any external caller use it.
- **CLI verbs** (`src/cli/git.ts`) and **MCP-stdio** (`repoyeti mcp`) are **thin HTTP clients to the
  loopback daemon** — they never touch git or the service layer in-process; they locate the live
  daemon and call its `127.0.0.1` API (single-instance respected). A boundary check enforces that
  `cli/*` and the MCP core/tools import no service/read/git layer.
- **MCP-HTTP** (`POST /api/mcp`) uses an **in-process adapter** into the service layer and is gated
  by the same `/api/*` auth middleware as every other route. (MCP-stdio reuses the same tool catalog
  via an HTTP adapter, so both transports advertise the identical 14 tools.)
- The full HTTP surface is described machine-readably at `GET /api/openapi.json` (see §6).

---

## 5. Data model (SQLite, WAL mode)

Minimal schema. `workspaces` exists for future identity inheritance but is **not** surfaced in the v1 UI.

```sql
-- repos discovered or registered
CREATE TABLE repos (
  id            TEXT PRIMARY KEY,           -- ULID
  abs_path      TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  source        TEXT NOT NULL,              -- 'auto' | 'pinned' | 'created'
  workspace_id  TEXT REFERENCES workspaces(id),
  identity_id   TEXT REFERENCES identities(id),  -- assigned identity (override)
  is_submodule  INTEGER NOT NULL DEFAULT 0,
  last_status   TEXT,                       -- JSON: {branch,dirty,ahead,behind,remote,error,fetched_at}
  updated_at    INTEGER NOT NULL
);

CREATE TABLE workspaces (                   -- schema-only in v1
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  default_identity_id TEXT REFERENCES identities(id)
);

CREATE TABLE identities (
  id              TEXT PRIMARY KEY,         -- ULID
  display_name    TEXT NOT NULL,            -- "Personal GitHub"
  git_username    TEXT NOT NULL,
  git_email       TEXT NOT NULL,
  ssh_key_path    TEXT,                     -- path ONLY; file never read by daemon
  pat_handle      TEXT,                     -- keychain handle, e.g. 'repoyeti/identity/<id>/pat' — NEVER the PAT
  signing_handle  TEXT                      -- reserved, unused in v1
);

-- Auth is "Sign in with Connections" (public OIDC, §7):
--   • the trusted owner identity (sub/email) lives in config + OS keychain ('repoyeti/owner-sub');
--   • the owner's Connections OAuth tokens live in the OS keychain, never in SQLite;
--   • a single 'sessions' row (or signed __Host- cookie) tracks the active daemon session;
--   • no password, PIN, or shared secret is ever stored.
CREATE TABLE sessions (                     -- the daemon's own RP session(s)
  id            TEXT PRIMARY KEY,           -- ULID
  owner_sub     TEXT NOT NULL,              -- verified Connections sub
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,           -- refreshed via the OAuth refresh token
  revoked       INTEGER NOT NULL DEFAULT 0
);
```

**Invariant:** no raw secret bytes ever land in SQLite — only key *paths* (SSH) and keychain
*handles*. The auth credential itself is issued and revoked by connections.icu, not by RepoYeti.

---

## 6. API surface (every route requires an authenticated session for the trusted owner)

| Method | Route | Purpose | Guards |
|---|---|---|---|
| `GET` | `/api/repos` | list repos + last status | — |
| `POST` | `/api/repos/register` | pin existing abs path | path exists + is a git repo |
| `POST` | `/api/repos/create` | `mkdir` + `git init` | path not exists |
| `POST` | `/api/repos/:id/fetch` | `git fetch` (updates behind) | op-queue |
| `POST` | `/api/repos/:id/pull` | FF-only pull | **409 `DIRTY_WORKING_TREE`** if dirty; FF-only |
| `POST` | `/api/repos/:id/push` | push current branch | **409 `NON_FAST_FORWARD`** if diverged; `--force` → **403** |
| `POST` | `/api/repos/:id/identity` | assign identity to repo | — |
| `GET` | `/api/identities` | list | — |
| `POST` `PUT` `DELETE` | `/api/identities[/:id]` | CRUD | PAT → keychain, never DB |
| `GET` | `/api/events` | SSE stream | session cookie |
| `GET` | `/oauth/login` | start "Sign in with Connections" (PKCE; `state` embeds daemon URL) | unauth → redirects to AEGIS via the shim |
| `GET` | `/oauth/finish` | shim bounces here: code → token → JWKS verify → set session | checks owner `sub` |
| `GET` | `/api/auth/me` | current session → `{ ok, sub, email }` | session cookie |
| `POST` | `/api/auth/logout` | clear daemon session | session cookie |

Auth is a single Hono middleware: every `/api/*` route requires a valid daemon session whose verified
`sub` equals the trusted owner; otherwise **401, empty body**. The only unauthenticated surface is the
static PWA shell + manifest and the two `/oauth/*` endpoints that run the login dance. See §7.

Every git operation returns a **structured result**: `{ ok, code, message }`. Error codes are
first-class (`DIRTY_WORKING_TREE`, `NON_FAST_FORWARD`, `SSH_AUTH_FAILED`, `SSH_PASSPHRASE_REQUIRED`,
`DETACHED_HEAD`, `TUNNEL_DOWN`, `AUTH_WRONG_OWNER`, `OIDC_VERIFY_FAILED`) so the UI can render the
right state.

> **The surface has grown well past the table above** (60+ routes: branches, log, stash, tags,
> remotes, files/diff, AI/smart-commit, servers, settings, …). Rather than enumerate them all here,
> the live surface is published machine-readably at **`GET /api/openapi.json`** (OpenAPI 3.1, built
> by introspecting the router; the one `/api/*` path fetchable without sign-in). The **MCP** tool
> server is exposed at **`POST /api/mcp`** (same JSON-RPC, same auth gate). For **remote/headless
> agents** an optional, owner-minted **Bearer API token** sits alongside the OIDC session
> (`POST`/`DELETE`/`GET /api/auth/token`); it's off by default and never weakens the OIDC posture
> (see §7 and `docs/REMOTE_ACCESS.md`).

---

## 7. Security model — "Sign in with Connections" (public OIDC), non-negotiable

> **Decision (owner directive):** RepoYeti is a **stand-alone codebase**. It uses connections.icu for
> **authentication only**, through the **public API** — never any internal/first-party mechanism. The
> earlier Studio-`introspection_secret` design is **dropped** (that's the internal first-party path).
> RepoYeti authenticates the owner via **"Sign in with Connections"**, connections.icu's public,
> standards-compliant **OpenID Connect** provider (AEGIS), exactly like any "Log in with Google" app.
> RepoYeti's only contact with connections.icu is calling its **public OAuth URLs**; it imports nothing
> from the Connections repo and shares no secret with it.

### The public provider (verbatim, public surface)

- **Issuer / IdP:** `https://accounts.connections.icu` (RS256 id_tokens, PKCE, refresh tokens)
- **Discovery:** `https://accounts.connections.icu/.well-known/openid-configuration`
- **Authorize:** `GET /oauth/authorize?client_id=…&redirect_uri=…&response_type=code&scope=openid%20profile%20email&code_challenge=…&code_challenge_method=S256&state=…`
- **Token:** `POST /oauth/token` (Authorization Code + PKCE)
- **Userinfo:** `GET /oauth/userinfo` → `{ sub, email, name, … }`
- **Contract:** `https://studio.connections.icu/v1/openapi.json`; integration guide:
  `docs/architecture/auth/ACCAP_SIGN_IN_WITH_CONNECTIONS.md`; button:
  `docs/how-to/SIGN_IN_WITH_CONNECTIONS_BUTTON.md`.

RepoYeti is registered once as a **third-party OAuth app** (relying party) → it gets a public
`client_id` and registers its redirect URI(s). See §13.

### How auth works

1. The user taps **"Sign in with Connections"** → standard **Authorization Code + PKCE** dance against
   `accounts.connections.icu/oauth/authorize` (scopes `openid profile email`).
2. The daemon catches the redirect (`?code&state`), exchanges the code at `/oauth/token`, and gets an
   **RS256 `id_token`** + access token.
3. The daemon **verifies the `id_token`** against the provider's **public JWKS** (from the discovery
   doc) — checks signature, `iss`, `aud` (its `client_id`), expiry — and/or calls `/oauth/userinfo`.
   **No shared secret is involved; verification uses public keys only.**
4. The daemon accepts **only if** the verified `sub` (or `email`) equals the **single owner** this
   daemon is configured to trust → otherwise `AUTH_WRONG_OWNER`. It then runs an ordinary session for
   that browser/device (a `__Host-` cookie or short-lived token — standard relying-party behavior; the
   IdP authenticates, the app keeps the session). Refresh tokens keep it alive without re-login.

### Login return = a fixed redirect "shim" — **DECIDED** (keeps the daemon on the free tunnel)

The login page must return to a **registered, stable** redirect URI — but the daemon sits on a free,
**rotating** quick-tunnel URL (AEGIS is redirect-based PKCE; no device-code flow exists). Squaring this
**without buying a domain or running ngrok**: register a tiny **fixed redirect shim** (a free, stable
edge URL you already have) and have it **bounce the login back to the daemon's current address.**

Flow (daemon-side PKCE — the phone never handles tokens):
1. Phone opens the daemon, taps "Sign in with Connections" → `GET /oauth/login` on the daemon.
2. The daemon makes PKCE + a signed `state` that **embeds its own current tunnel URL**, and redirects
   the phone to `accounts.connections.icu/oauth/authorize?…&redirect_uri=<SHIM>&state=…`.
3. AEGIS authenticates the user → redirects the phone to the **shim** (`<SHIM>?code&state`).
4. The shim reads `state`, checks the embedded daemon URL matches an **allowed pattern**, and
   **302-redirects** the phone to `<daemon-current-url>/oauth/finish?code&state`.
5. The daemon (`/oauth/finish`) verifies `state` (HMAC + CSRF nonce), exchanges `code` + its PKCE
   `code_verifier` at `/oauth/token` (with `redirect_uri=<SHIM>`), verifies the `id_token` via the
   **public JWKS**, checks the owner `sub`, and sets a `__Host-` session. Done.

**The only thing that must be stable + registered is the shim** — pick a free one you already have:
- **Cloudflare Worker** (`https://repoyeti-auth.<account>.workers.dev`) — *recommended*: server-side 302,
  validates the target host, no client JS, free, stable, **no custom domain**. ~30 lines; I can deploy it.
- **Cloudflare Pages** (`https://<proj>.pages.dev`) or **GitHub Pages** (`https://<user>.github.io/…`) —
  same idea as a tiny static page that reads `state` and redirects in-browser.

**Security:** the `code` is **PKCE-bound** to the daemon's `code_verifier` (held server-side) and
single-use, so intercepting it at the shim is useless; `state` is HMAC-signed and CSRF-checked by the
daemon; the shim only forwards to daemon URLs matching an allowed pattern (no open redirect). The shim
sees a transient, unusable code and nothing else.

**Upgrade path:** once you own a domain, give the daemon a stable URL, register its own `/oauth/callback`
directly, and the shim disappears (the *dashboard* URL stops rotating too).

**Desktop fallback (Path B):** register `http://127.0.0.1:<port>/oauth/callback` and log in once at the
machine — no shim, no tunnel — after which the phone is trusted.

RepoYeti stays **stand-alone** throughout — it only ever calls the public `accounts.connections.icu/oauth/*`
URLs; the shim is a dumb bounce on a free host, not a coupling to Connections.

### What an attacker with only the tunnel URL can do

Hit any endpoint → **401, empty body** (no surface, no version, no repo data). To get further they
must complete a real **Sign-in-with-Connections** login **as the trusted owner** — i.e. pass the
owner's own Connections/Cognito login (and its MFA). A valid login by a *different* Connections user
is rejected (`AUTH_WRONG_OWNER`). The daemon holds only a public `client_id` and the user's own
tokens; there is **no shared secret** whose leak would matter. Tunnel compromise stays neutralized at
the application layer.

### Secrets

- **OAuth `client_id`** is public; the daemon stores its OAuth config (issuer, client_id, redirect_uri)
  and the **trusted owner `sub`/`email`** in config + OS keychain (`repoyeti/owner-sub`); none of it is
  sensitive enough to leak access on its own. A confidential `client_secret`, **if** the app is
  registered as confidential, lives in the daemon keychain only (never shipped to the phone); a public
  PKCE client needs none.
- **The owner's Connections tokens** (access/refresh/id) live server-side on the **daemon** (keychain),
  refreshed as needed; the phone holds only the daemon's own session cookie, never the raw Connections
  tokens.
- **SSH keys:** the daemon **never reads key bytes** — it stores the *path* in SQLite and passes it
  to `ssh -i <path>`. Losing the DB does not leak keys.
- **Git PATs:** OS keychain by handle; resolved into a process env var **immediately before** the git
  subprocess call, never assigned to a module-level variable, logged, or serialized.
- **`keytar` fallback:** if keytar fails to load (common on Windows without build tools), encrypt the
  daemon-side secrets to an **AES-256-GCM** file in the config dir, key =
  `HKDF-SHA256(machineUUID ‖ username ‖ 'repoyeti-v1')`, perms `0600`, with a **loud, specific terminal
  warning**. Still external to SQLite, still not plaintext.

### Identity injection (never break the user's desk)

Per-operation only — **the global `~/.gitconfig` is never touched, and repo-local `.git/config` is
never mutated except on an explicit user "persist identity" action:**

```bash
GIT_SSH_COMMAND="ssh -i <ssh_key_path> -o IdentitiesOnly=yes -o BatchMode=yes" \
  git -c user.name="<name>" -c user.email="<email>" <pull|push|fetch>
```

- `IdentitiesOnly=yes` → SSH refuses any key not explicitly named (no wrong-agent-key fallback).
- `BatchMode=yes` → SSH **fails immediately** instead of hanging on a passphrase prompt.

### Action gating / failure handling

- **Pull preflight:** `git status --porcelain`; non-empty → **409 `DIRTY_WORKING_TREE`**, pull never runs.
- **Pull is fast-forward-only.** A non-FF pull would risk a merge the phone can't resolve → refuse.
- **Push:** non-FF → **409 `NON_FAST_FORWARD`**; `--force` → **403** unconditionally.
- **The daemon never leaves a repo mid-merge.** Every unsafe state surfaces as a clear status, not an action.
- Binds to **`127.0.0.1` only**; the *only* network path in is the authenticated tunnel.
- All git invocations use **parameterized argument arrays** via `simple-git` — never a shell string.

---

## 8. Known traps — engineer around these (surfaced by adversarial review)

These were not in the original briefs; they will bite if ignored.

1. **`keytar` × `bun --compile` native-addon compatibility is the #1 technical unknown.** Run a
   **Phase-1 spike** on Mac arm64, Windows x64, Linux x64 *before* committing. If it fails on a
   platform, the AES-256-GCM file becomes the *primary* there, not a fallback.
2. **SSH passphrase blocking.** Always pass `-o BatchMode=yes`; additionally put a **30s timeout** on
   every `simple-git` op and return **504 `SSH_PASSPHRASE_REQUIRED`** ("use ssh-agent or a
   passphrase-free key") if it hangs. Spec this as a first-class failure mode, not a footnote.
3. **"Behind" requires a network fetch.** **Never auto-fetch on a watch event.** "Behind" is
   stale-by-design (from last fetch); label it with a timestamp. Watch events only recompute
   local state (branch, dirty, ahead).
4. **Submodules.** During BFS, do not treat a submodule's `.git` (a file pointing to a worktree) as a
   top-level repo. Skip or mark `is_submodule=1` and exclude from the watcher budget.
5. **Windows WAL × antivirus** locks `-wal`/`-shm` files. Use `synchronous=NORMAL`, retry on
   `SQLITE_BUSY` (exp backoff, ≤5), and fall back to `journal_mode=DELETE` if WAL won't open.
6. **Bundle `cloudflared`** as a pinned per-platform binary inside the package — do **not** rely on a
   system install. Tunnel failure must be **non-fatal** (keep serving localhost + warn).
7. **Port conflict.** If the default port is taken, auto-increment to the next free port and print the
   actual port used.
8. **Per-repo op serialization** (the `Map<repoId,Promise>` queue) is what makes everything above
   safe under concurrency. Build it first, not last.

---

## 9. Build sequence (each phase is a demoable increment)

> Ordering is **non-negotiable**: auth lands *before* any network exposure. Shipping a tunnel before
> auth would directly violate the v2 non-negotiable.

- **Phase 1 — Core daemon skeleton + op queue (localhost only, no auth, no tunnel).**
  Discovery → watchers (`.git/HEAD`,`.git/index`) → status engine → `bun:sqlite` → `GET /api/repos`.
  Build the per-repo operation queue here. **Run the `keytar` + `bun --compile` spike on all 3 platforms.**
  *Done when:* `repoyeti start` locally; `GET /api/repos` returns accurate branch/dirty/ahead-behind
  within 1s of a local commit.

- **Phase 2 — "Sign in with Connections" (public OIDC).**
  `/oauth/login` (Authorization Code + PKCE → `accounts.connections.icu/oauth/authorize`,
  `scope=openid profile email`) + `/oauth/callback` (exchange at `/oauth/token`, verify the RS256
  `id_token` against the public JWKS from the discovery doc, confirm `sub`/`email` === trusted owner,
  set a `__Host-` session). Single Hono middleware gates every `/api/*` route. Reads OAuth config
  (issuer, `client_id`, redirect) + trusted owner from config/keychain (see §13).
  *Done when:* every `/api/*` route 401s until a Sign-in-with-Connections login as the owner completes;
  a login by a different Connections user → `AUTH_WRONG_OWNER`; URL-only attacker reads nothing.
  **(Builds against the public OIDC discovery doc; lights up once the owner registers the app + supplies
  `client_id` and trusted `sub` — §13.)**

- **Phase 3 — Identity management + safe git ops.**
  Identity CRUD (PAT → keychain); per-op `GIT_SSH_COMMAND` (`IdentitiesOnly`+`BatchMode`) + `git -c`;
  fetch/pull(FF-only, dirty preflight)/push(no-force, non-FF guard); 30s hang timeout.
  *Done when:* on the LAN, assign identity + tap Pull → daemon runs with that identity, result via SSE in ≤2s.

- **Phase 4 — cloudflared tunnel + mobile PWA.**
  Spawn cloudflared child; capture + print URL; emit `daemon_status` SSE. Embed Vue 3 PWA; wire SSE to
  watcher; flat repo cards + identity selector + action buttons; PWA manifest.
  *Done when:* `repoyeti start` → terminal prints the HTTPS URL (QR) → phone on LTE pastes its Connections
  key → full dashboard works. **← This is the v1 finish line (the success loop from §1).**

- **Phase 5 — Hardening + distribution.**
  Zod input validation; inotify-limit guard + 30s targeted-poll fallback; named-CF-tunnel upgrade path
  (`repoyeti.connections.icu` via Cloudflare, see §13); `bun --compile` for Win/Mac/Linux; `npm publish`;
  stage+commit-from-phone patch; workspace UI; multi-root; "sign out everywhere"; optional Path-A named tunnel.

- **Phase 6 — Tauri tray (explicitly deferred).**
  Thin Rust tray that spawns the **unchanged** daemon binary as a sidecar, monitors it, surfaces the
  dashboard URL + Sign-in status in the menu. Proves "100% shared core": CLI and tray run the identical binary.

---

## 10. Definition of Done (v1 acceptance criteria)

1. `repoyeti start` on a laptop with 3+ repos prints the tunnel URL, local URL, and a QR of the tunnel URL within 10s.
2. A phone **on LTE** (not the laptop's WiFi) opens the dashboard URL, taps **"Sign in with Connections"**,
   logs in as the owner, and reaches the dashboard — **no port forwarding, no router config**. (Path B: the
   owner completes the Connections login once at the laptop; the phone is then trusted.)
3. Dashboard shows every repo's branch, dirty count, and ahead count within 2s of load; behind count shows
   the last-fetch value with a timestamp label.
4. A local commit on the laptop updates the phone's dirty + ahead counts within 3s via SSE — **no reload**.
5. From the phone, selecting an identity and tapping Pull runs `git pull` with `GIT_SSH_COMMAND` pointing at
   that identity's key (`IdentitiesOnly=yes`); result (success or structured error) shows within 5s.
6. Pull on a dirty tree → **409 `DIRTY_WORKING_TREE`** ("resolve at your desk"); pull never executes.
7. Push on a diverged remote → **409 `NON_FAST_FORWARD`**; `--force` → **403** regardless of state.
8. Any `/api/*` request without an authenticated owner session → **401, empty body** (no version, no
   surface, no data); a Sign-in-with-Connections login by a *different* user → **401 `AUTH_WRONG_OWNER`**.
9. The `id_token` is verified against the provider's **public JWKS** (signature + `iss` + `aud` + expiry)
   before any session is issued; the owner's Connections tokens never appear in a client-facing payload.
10. `~/.gitconfig` and every repo's `.git/config` are **byte-identical** before and after a full
    fetch/pull/push cycle with identity injection (verify by checksum).
11. `npm install -g repoyeti && repoyeti start` works on Mac (arm64+x64), Linux x64, and Windows x64 with no
    extra runtime or dependency install.

---

## 11. Repo structure (minimal monorepo)

> **This grew past the flat tree in the original plan.** A maintainability reorg split the three
> god-files (`index.ts` / `daemon.ts` / `service.ts`) into layered directories. The layering is
> **structure, not behavior** — the same operations, just one public seam each.

```
repoyeti/
├─ package.json              # bun workspaces; bin: repoyeti (→ src/index.ts)
├─ src/
│  ├─ index.ts               # 2-line bin shim → cli/main.ts
│  ├─ cli/                   # the command-line front door
│  │  ├─ main.ts             #   dispatcher: start|add-root|status + git verbs + mcp + token
│  │  ├─ lifecycle.ts        #   daemon-lifecycle commands (start/add-root/status + boot helpers)
│  │  ├─ git.ts              #   git verbs (repos/log/branches/checkout/commit/diff/drift/stash/…)
│  │  ├─ client.ts           #   tiny HTTP client → loopback daemon (REPOYETI_BASE_URL/_TOKEN aware)
│  │  ├─ format.ts           #   zero-dep table / colour output
│  │  └─ token.ts            #   `repoyeti token new|revoke|show`
│  ├─ http/                  # the HTTP surface (Hono)
│  │  ├─ app.ts              #   composition root: wires routes/* behind the /api/* auth middleware
│  │  ├─ deps.ts             #   shared route deps (cfg, …)
│  │  ├─ respond.ts          #   structured {ok,code,message} response helpers
│  │  ├─ web.ts              #   static PWA mount (last, so /* doesn't shadow /api)
│  │  ├─ openapi.ts          #   builds the OpenAPI 3.1 doc by introspecting the router + META
│  │  └─ routes/             #   one module per domain (repos, branches, log, stash, tags, remote,
│  │     …                   #     files, ai, identities, roots, servers, git-ops, events, health,
│  │     …                   #     mode, repo-flags, auth, token, openapi, mcp)
│  ├─ service/              # the ONE orchestration layer (op-queue + guards live here)
│  │  ├─ core.ts             #   shared internals (op-queue access, repo lookup)
│  │  ├─ watch.ts            #   watcher → status-recompute → SSE wiring
│  │  ├─ actions.ts          #   fetch/pull/push/commit/checkout/branch/stash mutations
│  │  ├─ repo-mgmt.ts        #   register / create / clone / remove
│  │  ├─ reads.ts            #   status / log / branches / drift reads
│  │  ├─ files.ts            #   changed-files tree, file content/diff, search, discard, write
│  │  ├─ guards.ts           #   shared guardRepo() (NOT_FOUND / SUBMODULE)
│  │  └─ index.ts            #   barrel — the single public import surface for the service
│  ├─ read/                 # pure read-only inspection layer (no mutation, no service deps)
│  │  ├─ status.ts           #   simple-git status / branch / rev-list
│  │  ├─ inspect.ts          #   log + commit detail (parents/isMerge), changed-files
│  │  └─ diffstat.ts         #   per-file +/- diff stats (toggleable)
│  ├─ vcs/                  # pluggable VCS backend (VcsBackend interface)
│  │  ├─ index.ts · types.ts #   registry + interface
│  │  ├─ git.ts              #   git backend (default)
│  │  └─ lore.ts · lore-sdk.ts  # Epic's Lore (experimental, REPOYETI_LORE=1)
│  ├─ mcp/                  # hand-rolled MCP server (zero new deps; JSON-RPC 2.0 + MCP)
│  │  ├─ core.ts             #   transport-agnostic dispatch (initialize/ping/tools.list/tools.call)
│  │  ├─ tools.ts            #   the 14-tool catalog (readOnly vs MUTATES)
│  │  ├─ backend.ts          #   McpBackend interface the tools call
│  │  ├─ adapter-service.ts  #   in-process adapter (service/db) — behind POST /api/mcp
│  │  ├─ adapter-http.ts     #   HTTP adapter (cli/client) — behind `repoyeti mcp`
│  │  └─ stdio.ts            #   newline-delimited JSON stdio server; diagnostics → stderr
│  └─ (flat kernel)         # db.ts · discovery.ts · watcher.ts · opqueue.ts · git-actions.ts ·
│     …                      #   identity.ts · secrets.ts · auth.ts · tunnel.ts · runtime.ts ·
│     …                      #   instance.ts · config.ts · remote-sync.ts · ai.ts · bus.ts · …
├─ web/                      # Vue 3 + Vite + Tailwind PWA
│  ├─ src/ … (App, RepoCard, IdentitySelector, sse client)
│  └─ vite.config.ts         # build → embedded static assets
├─ shim/                     # OAuth redirect shim — now DEAD reference code (named tunnel + own /oauth/callback)
├─ vendor/cloudflared/       # pinned per-platform binaries
└─ scripts/build.ts          # vite build → bun --compile per target
```

The daemon is the **primary artifact**; `web/` builds into it; `vendor/cloudflared/` ships with it;
`shim/` is retired (the named tunnel + the daemon's own `/oauth/callback` replaced it — see
`docs/REMOTE_ACCESS.md`); a future `tray/` (Tauri) would spawn the same binary unchanged.
`scripts/check-boundaries.ts` enforces the layering: `read ⊥ service`, `vcs ⊥ service`, `cli ⊥
service/read/git`, and the MCP core/tools/backend touch the service only through their adapters.

---

## 12. Decisions explicitly closed (so they aren't re-litigated)

- **SQLite, not JSON** — concurrent writers. (All three briefs agree.)
- **SSE, not WebSockets** — server-push, event-driven, auto-reconnect through cloudflared.
- **Auth = "Sign in with Connections" (public OIDC), not a homegrown credential and not the internal
  Studio path** — RepoYeti is a stand-alone relying party that only calls the public
  `accounts.connections.icu/oauth/*` URLs and verifies tokens via the public JWKS; it shares no secret
  with and imports nothing from the Connections repo. (Owner directive: public API, auth only, stand-alone.)
- **DECIDED: free quick tunnel + a fixed redirect shim** (§7). The daemon stays zero-config on the free
  rotating tunnel; a tiny stable shim (Cloudflare Worker `*.workers.dev`, recommended — or Pages/GitHub
  Pages) is the registered OAuth redirect and bounces login back to the daemon, so the **phone logs in
  directly** with no domain and no ngrok. PKCE + signed `state` keep the bounce safe. The *dashboard* URL
  still rotates until a real domain is bought (then the shim is dropped).
- **Bun, not Node** — single-binary compile + built-in SQLite kills the worst Windows packaging pain.
- **Tauri deferred to last** — the CLI binary + phone browser is the whole product.
- **"Behind" is intentionally stale** — never auto-fetch on watch events.

---

## 13. connections.icu integration — what the owner provisions

RepoYeti is a **stand-alone relying party** that uses connections.icu **only** for "Sign in with
Connections" (public OIDC). It imports nothing from the Connections repo. To light up auth end-to-end
(everything else builds without it), the owner provides — all via the **public developer console**
(`studio.connections.icu` → developer apps), not by editing the Connections monorepo:

1. **A registered RepoYeti OAuth app.** Create a "Sign in with Connections" app → yields a public
   **`client_id`** (and, if registered confidential, a `client_secret` that stays only on the daemon).
   Scopes: `openid profile email`.
2. **The redirect URI** = the fixed **shim** URL (§7), e.g. `https://repoyeti-auth.<account>.workers.dev/cb`
   (Cloudflare Worker, recommended) or a `*.pages.dev` / `*.github.io` page. **This is the only stable URL
   that gets registered;** the daemon itself stays on the free rotating tunnel. (Optionally also register
   `http://127.0.0.1:<port>/oauth/callback` for the Path-B desktop fallback.)
3. **The trusted owner identity** — the `sub` (or email) RepoYeti should accept. Get it from
   `/oauth/userinfo` after a test login, or from the owner's account record. → daemon config/keychain.
4. **The redirect shim (free; I can build + deploy it).** A ~30-line **Cloudflare Worker** (or static
   Pages/GitHub page) that reads `state`, validates the daemon URL against an allowed pattern, and 302s
   the login back to the daemon. Lives on a free `*.workers.dev` / `*.pages.dev` / `*.github.io` URL —
   **no custom domain, not connections.icu's zone.** I can write + deploy the Worker via the Cloudflare/
   `saydeploy` MCP. It's dropped entirely once you own a domain and the daemon registers its own callback.

That's it — no AWS Secrets Manager entry, no Connections-repo change, no shared M2M secret. Everything
the daemon needs (issuer, client_id, redirect, scopes) is public OIDC config; the only sensitive item
is an optional confidential `client_secret`, which lives in the daemon keychain.

**Build-order note:** Phases 1, 3, 4 (daemon core, git ops, tunnel+PWA) need none of this. Phase 2
(auth) is built against the **public OIDC contract** above using the discovery doc, and lights up the
moment the owner registers the app and supplies the `client_id` + trusted `sub`.

---

*Marching orders end. Phase 1 starts with the watcher→SQLite→HTTP loop and the keytar spike — prove
those two and the rest is wiring. Auth (Phase 2) is a standard "Sign in with Connections" OIDC relying
party (§7/§13) and lights up the moment the owner registers the RepoYeti OAuth app.*
