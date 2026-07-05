# Add "Sync my settings with Connections" to this app

A portable spec for adding an **optional, one-click settings-sync** feature to a web app,
backed by [Connections](https://connections.icu) as the identity **and** storage provider.

> **Hand-off note:** This file is self-contained. Give it to an AI agent or a developer
> working on any codebase (a Vue/React/Svelte SPA, an Electron app, a CLI/daemon, an app with its
> own Node/Bun/Go backend, or a **native desktop app in Rust/Go/C++/C#** — see §4d + §5f). It tells
> you exactly what to build and what the owner must set up. Everything in the "Verified facts" and
> "Live contract" sections was probed live against the Connections API and is accurate as of
> **2026-07-04**.

> ## ⚡ Status update — the storage layer is now LIVE (2026-07-04)
>
> When this spec was first written (2026-07-03), the identity half was live and the storage half
> was still **"the only real thing you have to build"** (a ~100-line KV endpoint). **That endpoint
> now exists, is hosted by Connections, and is runtime-verified.** So this is no longer a
> *build-the-backend* spec — it's an *integrate-against-a-live-backend* spec:
>
> - **Endpoint:** `https://studio.connections.icu/v1/app-data/{appId}` — GET / POST / DELETE, plus
>   `/versions`, `/restore`, and owner-only `/server` + `/schema` sub-routes. See **§5**.
> - **It ships more than this spec originally called for:** optimistic-concurrency writes
>   (409-with-current-doc), RFC 7386 deep-merge partial writes, ETag/`304` conditional reads,
>   dual-window rate limits (120/min + 1,800/hr, `429`+`Retry-After`), a 64 KB cap, last-20 version
>   history + restore, a three-tier data model (user / server / private), optional per-app JSON
>   schema validation, first-party list/export, and **GDPR Art. 17 erasure on account deletion**.
> - **A reference client SDK exists:** `@lunawerx/locker` (+ `@lunawerx/locker/react`) — see **§5c**.
> - **Authoritative source of truth:** Studio's OpenAPI at `https://studio.connections.icu/v1/openapi.json`
>   (scheme `oauthUserToken`); it also self-populates the Connections MCP operator catalog
>   (`get_app_data_by_id` / `post_app_data_by_id` / `delete_app_data_by_id`). Design + verification
>   record lives in the Connections repo:
>   `docs/todo/jacob-do-me/connections-settings-sync-store.md` and
>   `docs/strategy/SETTINGS_SYNC_DATA_LOCKER.md`.
> - **One caveat for browser-hosted SPAs:** the gateway CORS preflight is still locked to the
>   Connections console origin, so a *third-party browser* app can't call it cross-origin **yet**
>   (one gateway-property flip away). **Desktop apps, CLIs, and local daemons — including RepoYeti,
>   DevWebUI, Reimagine — are unaffected** (no browser same-origin policy on a server-to-server
>   call). See **§5d**.

> ## ✅ Client wiring status — all three JS apps are LIVE (2026-07-04)
>
> This spec is fully implemented in the three sibling daemon apps (§4c shape); only a real
> cross-machine round-trip remains to be exercised by the owner. _(This subsumes the former
> `SETTINGS_SYNC_STATUS.md` resume-note, folded in here.)_
>
> - **RepoYeti** — the reference integration: `src/connections-sync.ts` (daemon BFF; refresh token
>   in the OS keychain), `src/http/routes/sync.ts` (`GET/PUT /api/settings/sync` + `/pull` + `/push`),
>   `auth.ts` `onTokens` capture, boot-time background pull, and the opt-in
>   `web/src/components/settings/CloudSyncSection.vue`. client_id `a790090c23b353c15ed973fd5fe20563`.
>   Syncs an allowlisted pref set + appearance `{theme}`.
> - **DevWebUI** — wired; client_id `622a12e32d0b39c68f56c63316f351e5`; state in
>   `~/.devwebui/connections.json` (`0600`); no auth gate needed (no tunnel/remote mode).
> - **Reimagine** — wired; client_id `61c299a8207889e59d3a43faaf9b6524`; CommonJS server, theme-only
>   (its other "settings" are content/secrets and never sync).
> - **Shared client** — `connections-locker.mjs` (+`.d.mts`) lives in the `lunarwerx-ui` kit and is
>   synced into the apps; drift-checked by `sync.mjs --check`.
>
> **The one genuinely open item:** a real cross-machine round-trip is untested — every layer up to
> the network boundary is runtime-verified, but the full push/pull needs an owner browser sign-in on
> two machines (sign in → flip theme → see it land, ~5 min). The browser-CORS flip (§5d) and the Rust
> apps (§4d/§5f — SageThumbs 2K, QuickDictate, not yet wired) are the other deferred items.

---

## 1. What we're building (the user-facing goal)

A small, **opt-in** control on the Settings page — an icon or a "Sync settings" button, nothing
more. When the user clicks it:

1. They're asked to **sign in with their Connections account** (or create one). This is a
   standard OAuth/OIDC redirect to `accounts.connections.icu`.
2. After they come back signed in, the app **pushes their current settings to the cloud** and,
   from then on, **pulls them on every device/app** where they sign in with the same account.
3. If they never click it, nothing changes — settings stay local. Sync is purely additive.

The magic: the **same Connections account produces the same user id (`sub`) in every app**, so
one person's theme/accent/layout/preferences follow them across this app, its sibling apps, and
any future app that adopts this same spec.

---

## 2. Architecture in one picture

```
  ┌─────────────┐   1. OIDC login (Authorization Code + PKCE, public client, NO secret)
  │   The App    │ ───────────────────────────────────────────────► accounts.connections.icu
  │  (browser or │ ◄─────────────── id_token + access_token ───────  (Connections identity / AEGIS)
  │   daemon)    │        (contains a stable `sub` for this user)
  └──────┬──────┘
         │
         │   2. GET / POST / DELETE the user's settings doc, authorized by that token
         ▼
  ┌────────────────────────────────────────────────┐   LIVE, hosted by Connections (Studio plane).
  │  https://studio.connections.icu/v1/app-data/…   │   Validates the token against AEGIS' JWKS,
  │  one JSON doc per (verified sub, appId=client_id)│   derives (sub, app_id) from the token,
  └────────────────────────────────────────────────┘   reads/writes one row. No backend for you.
```

Two independent layers. **Do not conflate them** — but note that **both are now provided by
Connections**, so your build is just the thin client glue:

| Layer | What it does | Who provides it | Your build effort |
|-------|--------------|-----------------|-------------------|
| **Identity** | "Sign in with Connections", gives you a stable per-user `sub` | Connections (live) | ~none — standard OIDC |
| **Storage** | Stores/returns the per-user settings JSON | **Connections (LIVE)** — `/v1/app-data` | ~none — call it (or use the `@lunawerx/locker` SDK) |
| **Client glue** | Login button, settings choke-point hook, key allowlist | **You** | small — a few hundred lines, mostly UI |

Connections is a full OIDC provider **and now exposes a generic per-user key-value / "app-data"
store** to registered apps (its other writable per-user objects remain the semantic ones —
contacts, events, forms, a MyConnect profile). The settings doc has a first-class home. See §5.

---

## 3. Verified facts about Connections (probe results)

**Identity provider (OpenID Connect):** discovery doc at
`https://accounts.connections.icu/.well-known/openid-configuration`

| Field | Value |
|-------|-------|
| `issuer` | `https://accounts.connections.icu` |
| `authorization_endpoint` | `https://accounts.connections.icu/oauth/authorize` |
| `token_endpoint` | `https://accounts.connections.icu/oauth/token` |
| `userinfo_endpoint` | `https://accounts.connections.icu/oauth/userinfo` |
| `jwks_uri` | `https://accounts.connections.icu/oauth/jwks` (1 key, `RS256`) |
| `response_types_supported` | `["code"]` |
| `grant_types_supported` | `authorization_code`, `refresh_token`, `device_code`, `client_credentials` |
| `code_challenge_methods_supported` | `["S256"]` → **PKCE supported** |
| `token_endpoint_auth_methods_supported` | `["none", "client_secret_post", "client_secret_basic"]` → **`none` = public SPA clients supported, no secret needed** |
| `subject_types_supported` | `["public"]` → **same `sub` for a given user across ALL apps** (the cross-app sync key) |
| `id_token_signing_alg_values_supported` | `["RS256"]` |
| `claims_supported` | `sub`, `name`, `given_name`, `family_name`, `picture`, `email`, `email_verified`, `entitlements`, `is_paid`, `custom_answers` |

**Two token shapes both work at the store.** The login gives you an RS256 JWT access token; every
refresh mints an **opaque** access token. The store verifies **both** (JWT via JWKS, opaque via
userinfo introspection) — so you never have to special-case which one you're holding.

**Identity consent scopes you should request:** `openid profile email` (add `photo` if you want the
avatar). That's all the sync feature needs — **the store does not require any storage scope**;
authorization is the user's token + your app's `client_id`. Full scope catalog:
`GET https://studio.connections.icu/v1/oauth-scopes`.

**Registering the "Sign in with Connections" app (owner does this once):**
```
POST https://studio.connections.icu/v1/oauth-apps
Authorization: Bearer <OWNER_DEV_KEY>          # cnx_live_… — OWNER ONLY, never shipped to clients
Content-Type: application/json

{
  "name": "RepoYeti / DevWebUI / <your app>",
  "redirectUris": [
    "https://app.example.com/connections/callback",
    "http://localhost:5173/connections/callback"     // add each dev/self-host origin you need
  ],
  "homepageUrl": "https://example.com",
  "scopes": ["openid", "profile", "email"]
}
→ { "client_id": "...", "client_secret": "...(shown once)..." }
```
- The returned **`client_id` IS your `appId`** for the store (§5) — the two are the same value.
- One app registration can carry **many redirect URIs** — you can share a single `client_id`
  across all sibling apps, or register one per app. **Registering one per app is recommended for
  the store**, because the store namespaces data by `client_id`: separate ids give each app its own
  isolated per-user doc, while a shared id makes all apps share one doc (fine only if you *want*
  that). See §6 on namespacing.
- For a **public SPA / desktop client** you use only the `client_id` (+ PKCE). You can ignore the
  `client_secret`. Keep the secret **only** if you run the robust BFF variant (§4b).
- Edit URIs later without re-registering: `PATCH /v1/oauth-apps/{id}`.

> **RepoYeti is the reference integration.** It already has "Sign in with Connections" fully built
> (`src/auth.ts`, `src/config.ts`) with a baked-in public client_id `a790090c23b353c15ed973fd5fe20563`
> and jose/JWKS validation. Its login half is done; only the store glue (§6) remains.

---

## 4. The login flow (identity layer)

Pick **4a** (simplest) unless you want tokens to never touch JavaScript, then pick **4b**. If your
app is a local daemon, **4c** is the sweet spot (and it also sidesteps the browser-CORS caveat in
§5d entirely).

### 4a. SPA-only, public client + PKCE (simplest — no backend for login)

Standard OAuth 2.0 Authorization Code + PKCE. In the browser:

1. **Start:** generate a random `code_verifier`, derive `code_challenge = S256(code_verifier)`,
   store `code_verifier` + a random `state` in `sessionStorage`, then redirect to:
   ```
   https://accounts.connections.icu/oauth/authorize
     ?response_type=code
     &client_id=<CLIENT_ID>
     &redirect_uri=<THIS_APP_CALLBACK_URL>
     &scope=openid%20profile%20email
     &code_challenge=<CHALLENGE>
     &code_challenge_method=S256
     &state=<STATE>
   ```
2. **Callback:** at your `redirect_uri`, verify `state`, then exchange the `code`:
   ```
   POST https://accounts.connections.icu/oauth/token
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code
   &code=<CODE>
   &redirect_uri=<SAME_CALLBACK_URL>
   &client_id=<CLIENT_ID>
   &code_verifier=<VERIFIER>
   ```
   → `{ access_token, id_token, refresh_token?, expires_in, token_type }`
3. **Identify:** decode the `id_token` (JWT) or call `GET /oauth/userinfo` with
   `Authorization: Bearer <access_token>`. Keep the `sub` — that's the sync key. Keep `email` /
   `name` / `picture` to show "Synced as you@example.com".
4. **Refresh:** when `access_token` nears expiry, POST `grant_type=refresh_token&refresh_token=…&client_id=…`.
   (Refresh mints an **opaque** access token; the store accepts it — see §3.)

> **CORS note:** a *browser* SPA that wants to call the store cross-origin is currently gated at the
> gateway preflight (§5d). Browser token exchange (`POST /oauth/token`) is a separate concern
> allowed by the public-client (`none`) support. If a deployment's CORS blocks either, route those
> calls through a small server (§4b/§4c) — which you likely already have.

**Don't hand-roll PKCE if you can avoid it.** Use a small, audited OIDC client library
(e.g. `oidc-client-ts` for browser SPAs, or your framework's OAuth plugin). Point it at the
discovery URL above; it handles PKCE, state, token refresh, and JWT validation.

### 4b. BFF variant (most secure — tokens never touch JS)

If you're standing up any server and want maximum security, make it a **Backend-for-Frontend**:
it performs the code→token exchange (as a confidential client using the `client_secret`), keeps the
`refresh_token` server-side, hands the browser an **httpOnly, Secure session cookie** instead of
tokens, and calls the store server-to-server. This is the OAuth-for-SPAs best practice, eliminates
token theft via XSS, **and bypasses the §5d browser-CORS caveat** (the server call has no
same-origin policy).

### 4c. If your app is a local daemon (localhost server + browser UI) — prefer this

Many dev tools are a **single-user local daemon**: a small server bound to `127.0.0.1` that serves
a Vue/React SPA to a browser tab (optionally exposed remotely via a tunnel). **RepoYeti (Bun/Hono
:7171), DevWebUI (Bun/Hono :4000), and Reimagine (Node http :5178) are all this shape.** The
daemon **is** your BFF — use it:

- The daemon runs the OIDC login (§4a) and **retains the `refresh_token`** in a secure server-side
  spot (OS keychain if available, else a `0600` JSON file under the app's config dir — the same
  place the app already keeps other secrets).
- To sync, the **daemon** (not the browser) calls the store (§5) server-to-server, minting a fresh
  access token from the refresh token as needed. **No browser CORS, no tokens in JS, works today.**
- The SPA just calls a local daemon route (e.g. `GET/PUT /api/settings/sync`) behind the daemon's
  existing session/auth. The daemon translates that into the cloud call.
- Because these tools are single-user, "the owner's `sub`" from login is the only identity you
  need — the store row is keyed by that one `sub` (per `appId`). Cross-machine sync happens because
  the same person signs into the daemon on machine B with the same account → same `sub`.

### 4d. Native desktop / CLI apps (no web UI, no daemon) — the loopback redirect

Not every app is web-shaped. A **native app** — a Rust/Go/C++/C# desktop GUI, a tray app, a CLI, a
Windows shell extension — has no browser it owns and no long-running localhost server. It still does
the **exact same** Authorization Code + PKCE flow (§4a); the only twist is *where the redirect lands*.
Use **loopback interface redirection** (the OAuth-for-native-apps standard, RFC 8252 §7.3):

1. **Spin a throwaway loopback listener.** Bind a TCP socket to `127.0.0.1:0` (OS picks a free
   port). This is a few lines; it lives only for the duration of one sign-in.
2. **Open the system browser** to the authorize URL (§4a step 1) with
   `redirect_uri=http://127.0.0.1:<that-port>/callback` (open via `ShellExecute` / `xdg-open` /
   `open`, or a crate like `open`). The user signs in in their real browser — the app never renders
   a login form or handles a password.
3. **Catch the redirect.** The browser hits your loopback listener with `?code=…&state=…`. Verify
   `state`, respond with a tiny "You can close this tab" HTML page, then shut the listener down.
4. **Exchange + refresh exactly as §4a** (steps 2–4): POST the `code` (+ `code_verifier`) to the
   token endpoint, keep the `refresh_token`, mint access tokens as needed.

- **The native app IS its own single-process BFF.** It holds the `refresh_token` itself and calls the
  store (§5) directly over HTTPS — there is no browser in the token path, so **the §5d browser-CORS
  caveat never applies** to native apps.
- **Store the `refresh_token` in the OS credential store, never in a plaintext settings file.** On
  Windows: the Credential Manager (the Rust `keyring` crate, or DPAPI-encrypted bytes in the app's
  own store). macOS Keychain / Linux libsecret via the same `keyring` crate. The access token can
  stay in memory.
- **Owner registration:** register `http://127.0.0.1/callback` **and** `http://localhost/callback` as
  redirect URIs for the app (RFC 8252 says the IdP must allow **any port** on a loopback redirect, so
  you register the host without pinning a port). Each native app is its own OAuth app → its own
  `client_id` (= its own store `appId` namespace + independent version tracking).
- **Single-user by nature:** the signed-in `sub` is the only identity; the store row is keyed by
  `(sub, appId)`. Sign in on machine B with the same account → same `sub` → the settings follow.

> **Two concrete Rust shapes (both Windows apps in this family):**
> - **An async app that already has `tokio` + `reqwest`** (e.g. QuickDictate): use a `tokio`
>   `TcpListener` for the loopback catch, `reqwest` for the token exchange + store calls, and the
>   `keyring` crate for the refresh token. This is the smoothest path — ~200–400 LOC.
> - **A synchronous / Win32 app with no async runtime** (e.g. a shell-extension host like
>   SageThumbs 2K, which already does HTTPS via WinINet): the loopback catch is a blocking socket
>   accept on a worker thread; the token exchange + store calls go over the app's existing
>   synchronous HTTPS (WinINet, or a small crate like `ureq`); the refresh token goes in
>   `HKCU\…\OAuth` (DPAPI-encrypted) or the Credential Manager. No async runtime needed.
>
> See §5f for the raw store contract these call (there is **no** Rust SDK — the contract is small
> enough to call directly).

---

## 5. The settings store (storage layer) — **LIVE; you call it, you don't build it**

The store is a first-class Connections endpoint. One JSON document per **(verified `sub`, `appId`)**,
where `appId` is your app's OAuth `client_id`. **Both `sub` and `app_id` are derived from the
verified bearer token — never from the request body** — so one app can never touch another app's row
for a user, and no user can reach another user's row. There are no security rules to configure and
none to forget.

- **Base URL:** `https://studio.connections.icu/v1/app-data/{appId}`
- **Auth:** `Authorization: Bearer <the signed-in user's own access token>` (RS256 JWT *or* opaque —
  both verified). The path `{appId}` **must equal** the token's `client_id`, else `403 app_mismatch`.
- **Canonical contract:** `https://studio.connections.icu/v1/openapi.json` (scheme `oauthUserToken`).

### 5a. The core routes (the only three most apps need)

```
GET    /v1/app-data/{appId}
  → 200 { app_id, settings:{…}, server_settings:{…}, version, updated_at, bytes_used, max_bytes }
        Response carries  ETag: "<version>"  (and access-control-allow-origin: *, cache-control: no-store)
  → 304  if you send  If-None-Match: "<version>"  and nothing changed (cheap polling)
  → never-written user → 200 { settings:{}, server_settings:{}, version:0, updated_at:null, bytes_used:0, max_bytes }

POST   /v1/app-data/{appId}
  body { settings:{…}, baseVersion:<n>, merge?:true }
  → 200 { ok:true, app_id, version, bytes_used, max_bytes }         # baseVersion matched (0 on first write)
  → 409 { error:"version_conflict", current:{ settings, version } } # stale write — re-read/merge/retry
  → 413 { error:"settings_too_large", bytes_used, max_bytes }       # doc > 64 KB (max_bytes = 65536)
  → 422 { error:"schema_violation", violations:[…] }                # only if the app registered a schema (§5b)
  → 429 { error:"rate_limited", limit:"120/min"|"1800/hr", retry_after_seconds }  + Retry-After header
  # merge:true → RFC 7386 JSON Merge Patch: only sent keys change; null deletes a key; nested objects
  #   merge; arrays/scalars replace whole. This is the race-free way to save one changed setting.

DELETE /v1/app-data/{appId}
  → 204   # "forget this app / stop syncing" — deletes the doc AND its version history. Idempotent.

# Auth failures on any route:
  → 401 { error:"not_authenticated", hint:"Present the signed-in user's own …access token as a Bearer." }
  → 403 { error:"app_mismatch" }   # path {appId} != token client_id
```

**`settings` is one JSON object, ≤ 64 KB** (`max_bytes = 65536`). It's for settings/small state —
explicitly **not** a secret vault (no secrets, no PII) and **not** blob storage.

### 5b. Extra routes (use them if you want them; ignore them otherwise)

```
GET    /v1/app-data/{appId}/versions
  → 200 { app_id, versions:[ { version, replaced_at, bytes } … ] }   # last ≤20 replaced user-tier docs
POST   /v1/app-data/{appId}/restore
  body { version:<n> }  → same success shape as a write; 404 { error:"version_not_found" } if gone
                          (restore counts as a normal write for rate-limiting)

# Owner-only (require the app owner's credential — a cnx_live_ key with `apps:write`, or a Studio
# session that owns the app registration; NEVER put these in a client). These write the two
# non-user tiers described below:
GET/POST /v1/app-data/{appId}/server    # write server_settings (user-readable) / private_settings (owner-only)
GET/POST /v1/app-data/{appId}/schema    # register/clear the optional per-app JSON schema

# First-party (a Connections session bearer, i.e. the user themselves on connections.icu — the
# future "your synced apps" panel; not something an external app calls):
GET    /v1/app-data                 → { apps:[ { app_id, bytes_used, max_bytes, version, updated_at, has_server_data } … ] }
GET    /v1/app-data?format=export   → the user's full docs across all apps (raw JSON export)
```

**Three-tier data model (Clerk-style), all in the same doc, one shared `version`:**
| Tier | Written by | Readable by | Use for |
|------|-----------|-------------|---------|
| `settings` | the **user's** own token (your app, client-side) | the user | theme, accent, layout, feature toggles |
| `server_settings` | the **app owner** (server creds only) | the user (read-only) | plan, entitlements, credits pushed from your backend |
| `private_settings` | the **app owner** (server creds only) | owner only | backend-only per-user state |

For a pure settings-sync feature you only touch `settings`. The server tiers are there if your app
later wants to push entitlements to the client without the client being able to forge them.

### 5c. The reference client SDK — `@lunawerx/locker`

A tiny typed client + React binding lives in the Connections monorepo at
`packages/connections-locker` (`@lunawerx/locker`, MIT). It wraps everything above: ETag-cached
`get()`, auto-retrying `set()` (with an `onConflict` hook), race-free `merge()`, `delete()`,
`versions()`, `restore()`, and a `LockerError` carrying `status` / `code` / `retryAfterSeconds` /
`violations`.

```ts
import { createLocker } from "@lunawerx/locker";

const locker = createLocker({
  appId: "<YOUR_OAUTH_CLIENT_ID>",
  getToken: () => currentAccessToken(),   // refresh-aware; returns the signed-in user's token
  // baseUrl defaults to https://studio.connections.icu
});

const doc = await locker.get();                 // { settings, server_settings, version, bytes_used, max_bytes, … }
await locker.set({ theme: "dark", accent: "violet" });   // full replace, auto-merges on 409 (≤3 tries)
await locker.merge({ layout: null });           // RFC 7386 partial update (null deletes "layout")
```

```ts
// React one-liner:
import { useUserSettings } from "@lunawerx/locker/react";
const { settings, serverSettings, update, isLoading, error, refresh } = useUserSettings(locker);
update({ theme: "dark" });   // optimistic locally, deep-merged server-side in the background
```

> **Packaging caveat (accurate as of 2026-07-04):** `@lunawerx/locker` is **not published to npm
> yet** (the registry returns 404) and its `main` points at raw TypeScript (`src/index.ts`) — it's
> the *reference implementation* inside the Connections monorepo. Until it's published, either
> **vendor the two source files** (`src/index.ts` + `src/react.ts`, ~230 lines total) into your app,
> or **call the §5a contract directly** (it's small and stable). Publishing it is the owner's call;
> nothing about the integration depends on it landing on npm first.

### 5d. The one deferral that matters — browser CORS for third-party WEB apps

The store's *responses* already carry `access-control-allow-origin: *` (no credentials), but the
**gateway's CORS preflight is still locked to the Connections console origin**. Consequence:

- **Desktop apps, CLIs, and local daemons work today** — a server-to-server (or non-browser) call
  never issues a CORS preflight. **RepoYeti, Reimagine, and any daemon-BFF (§4c) are unaffected.**
- **A third-party *browser* SPA calling the store cross-origin is blocked at preflight — for now.**
  If/when a browser-hosted consumer needs it (e.g. DevWebUI as a pure SPA), it's a **one gateway
  property flip** on the Connections side (drop/relax `corsPreflight` on `StudioHttpApi`); the
  response headers are already correct. Until then, route store calls through your own server
  (§4b/§4c) — which the daemon apps already do.

### 5e. Self-hosting the same contract (optional, almost certainly unnecessary)

Because the contract is small and the app talks to it through one `baseUrl`, you *could* stand up
your own service implementing the same `/app-data/{appId}` shape and point `baseUrl` at it — the app
code wouldn't change. **You almost certainly shouldn't**: Connections already hosts it, verifies
both token shapes, does GDPR erasure fan-out, and is the shared cross-app store that makes sync work
in the first place. This is documented only so you know the seam exists.

### 5f. Calling the store from a non-JS app (Rust / Go / C++ …) — raw HTTP, no SDK

There is **no** Rust/Go/C++ SDK — and none is needed. The store is three plain HTTPS calls (§5a). Any
language with an HTTP client and a JSON serializer integrates it directly; the JS `@lunawerx/locker`
(§5c) is just an ergonomic wrapper you can read as a reference. The rules are identical to §5a:

- `appId` = your app's OAuth `client_id`; `Authorization: Bearer <the signed-in user's access token>`
  (minted from the refresh token you kept in §4d). Send `content-type: application/json`.
- `GET /v1/app-data/{appId}` → `{ settings, version, … }` (a never-written user → `version:0`).
- `POST /v1/app-data/{appId}` body `{ "settings": {…}, "baseVersion": <n>, "merge": true }` — prefer
  `merge:true` (RFC 7386 deep-merge, race-free per key). On `409` re-`GET`, re-apply, retry.
- `DELETE /v1/app-data/{appId}` → `204` to disconnect / forget.
- Handle `429` (honor `retry_after_seconds`) and `413 settings_too_large` (doc > 64 KB).

A minimal **async Rust** client (`reqwest` + `serde_json`) — the shape a `tokio` app (e.g.
QuickDictate) would use; a synchronous app swaps `reqwest` for `ureq`/WinINet with the same calls:

```rust
// appId = your OAuth client_id; token() returns a fresh access token (refresh-aware, from §4d).
const BASE: &str = "https://studio.connections.icu/v1/app-data";

async fn pull(http: &reqwest::Client, app_id: &str, token: &str)
    -> reqwest::Result<serde_json::Value> {
    let doc: serde_json::Value = http
        .get(format!("{BASE}/{app_id}"))
        .bearer_auth(token)
        .send().await?.error_for_status()?
        .json().await?;
    Ok(doc["settings"].clone())            // {} when version == 0 (nothing stored yet)
}

async fn push(http: &reqwest::Client, app_id: &str, token: &str, partial: serde_json::Value)
    -> reqwest::Result<()> {
    http.post(format!("{BASE}/{app_id}"))
        .bearer_auth(token)
        .json(&serde_json::json!({ "settings": partial, "baseVersion": 0, "merge": true }))
        .send().await?.error_for_status()?;  // deep-merge: only the keys you send change
    Ok(())
}
```

> **⚠️ Never sync secrets or machine-local state — this matters most for native apps.** Sync only
> portable preferences (theme, hotkeys, text-replacement rules, UI toggles). Do **NOT** sync the
> plaintext provider API keys QuickDictate keeps in its `settings.json`, or SageThumbs 2K's local
> upload-host config / absolute paths. Maintain an explicit allowlist of synced keys (§6.6). The
> store enforces this too — it's a settings locker, not a secret vault (no secrets, no PII, ≤64 KB).

---

## 6. Client integration steps (do these in the app)

1. **Config.** Add the OIDC discovery URL, `client_id` (= your `appId`), and — if you're not using
   the default — the store `baseUrl` to app config/env. No secrets in the client (unless BFF/daemon,
   where the `client_secret` and refresh token live only on the server).
2. **Find the settings choke-point.** Locate the single module that loads and saves settings today
   (a store, a `useSettings()` composable, a `settings.json` reader). All sync hooks go there so you
   touch persistence logic in exactly one place.
3. **Add a `SyncClient` module** with `login()`, `logout()`, `isSignedIn()`, `currentUser()`, and
   `pull()` / `push()` — backed by the OIDC library (§4) for identity and by `@lunawerx/locker`
   (§5c) — or a direct fetch of §5a — for storage. For daemon apps, `push`/`pull` are thin daemon
   routes that call the store server-to-server.
4. **Wire the choke-point:**
   - **On save** (settings change) — if signed in, debounce and `push()` the new blob. Prefer the
     store's `merge()` for single-key changes (race-free) and `set()` for a full replace.
   - **On login / app start when signed in** — `pull()` (`GET`); if remote `version > 0`, apply it
     (see merge policy below); if remote is empty (`version:0`), `push()` the current local settings
     as the initial seed.
   - Keep writing to **local storage too** — the cloud is a sync layer over the local source of
     truth, so the app still works offline / signed out.
5. **Merge / conflict policy — use the store's real primitives (don't invent one).** The store gives
   you optimistic concurrency, not last-write-wins:
   - Every `GET` returns `version`; send it back as `baseVersion` on the next write. A stale write
     gets `409` with the server's `current` doc — re-read, reconcile, retry. The SDK's `set()` does
     this automatically (bounded to 3 tries, with an `onConflict(current, mine)` hook); `merge()` is
     inherently race-free per key. Surface the outcome to the user ("Settings updated from another
     device") when a conflict was reconciled.
   - Handle `429` by honoring `retry_after_seconds` (the SDK surfaces it on `LockerError`).
6. **Decide which keys are syncable (the one real judgment call).** Sync portable prefs (theme,
   accent, layout, feature toggles). **Do not** sync machine-specific or secret values (absolute
   file paths, local tokens, window geometry, per-machine credentials, API keys). Maintain an
   explicit **allowlist** of synced keys — never blindly sync the whole settings object. (Also
   respects the 64 KB cap and the "settings only, no secrets" contract.)
7. **Namespacing across sibling apps.** Each app's `appId` (= its own `client_id`) gives it an
   isolated per-user doc — sibling apps don't collide. If two apps *want* to share a subset of prefs
   (e.g. one accent across the suite), the clean way is to **register them under the same `client_id`**
   so they read/write the same doc, or keep separate ids and sync a shared "appearance" section
   app-to-app in your own glue. Default to **separate ids** unless you deliberately want shared data.
8. **The UI (small, opt-in).** A single control in Settings with these states:
   - *Signed out:* an icon/button — "Sync settings with Connections". Click → `login()`.
   - *Signing in:* spinner during redirect/callback.
   - *Signed in:* a compact row — avatar/email + "Synced ✓" + a "Stop syncing / Sign out" action
     (call the store's `DELETE` to forget the remote doc if the user wants a clean disconnect).
   - *Error:* inline, non-blocking ("Couldn't reach sync — using local settings").
   Nothing about this should be load-bearing; if the user ignores it, the app is unchanged.
9. **Privacy copy.** One line near the button: what syncs, where it goes (their Connections
   account), that it's optional, and that they can disconnect (sign out + `DELETE` the remote doc).

---

## 7. Security rules (non-negotiable)

- **Never put the owner `cnx_live_…` key in any client, bundle, repo, or browser.** It's a god-key
  (billing, revenue, key-minting, every user's data). Clients only ever hold the **end-user's own**
  token, obtained via the user's own login. The store's user-tier routes need *only* that token.
- **The `server_settings` / `private_settings` tiers and the `/server` + `/schema` routes require
  owner credentials — keep them server-side only.** A client can *read* `server_settings`; it can
  never write any server tier.
- **Request least privilege:** `openid profile email` for identity. The store needs **no extra
  scope** — don't request contacts/events/pay/etc.
- **Token validation is Connections' job, done for you.** The store verifies the JWT/opaque token,
  `iss`, `aud`/`client_id`, and `exp`, and derives `sub` + `app_id` from the verified token. You
  never trust a client-supplied `sub`. (If you ever self-host §5e, you must replicate this.)
- **Prefer BFF/daemon (§4b/§4c) when a server exists** so tokens never live in JS (XSS-resistant)
  — and it sidesteps §5d. If tokens must live in the browser, keep them in memory, refresh via the
  refresh token, and never in `localStorage`.

---

## 8. One-time owner setup checklist

- [x] Register the OAuth app → get `client_id` (§3). Add every redirect URI (prod + each
      dev/self-host origin). **This `client_id` is the app's `appId` for the store.** — **DONE for
      the LunarWerx apps (each its own registration, per "separate versions"):** RepoYeti
      `a790090c23b353c15ed973fd5fe20563` · **DevWebUI `622a12e32d0b39c68f56c63316f351e5`** ·
      **Reimagine `61c299a8207889e59d3a43faaf9b6524`** (both minted 2026-07-04 with `openid profile
      email` + `http://localhost:<port>/oauth/callback` + `http://127.0.0.1:<port>/oauth/callback`
      loopback URIs; public PKCE clients, no secret shipped). Native apps (SageThumbs 2K,
      QuickDictate) get their own when wired (register a bare `http://127.0.0.1/oauth/callback` for
      RFC 8252 any-port loopback).
- [x] ~~Stand up the settings KV service~~ — **DONE.** It's live at
      `https://studio.connections.icu/v1/app-data/{appId}`, hosted on the Studio plane, with GDPR
      erasure fan-out wired in. No owner action here.
- [ ] Hand the integrating app(s): the discovery URL, the `client_id`/`appId`, and (only if
      BFF/daemon) the `client_secret` **to the server side only**. Store `baseUrl` defaults to
      `https://studio.connections.icu` — pass one only for a self-hosted §5e variant.
- [ ] *(Only if a third-party browser SPA needs the store cross-origin)* flip the gateway CORS
      preflight (§5d). Not needed for desktop/CLI/daemon apps.
- [ ] *(Optional)* publish `@lunawerx/locker` to npm if you'd rather apps `npm install` it than
      vendor the source (§5c).

## 9. Per-app implementation checklist (for the integrating agent/dev)

- [ ] Add OIDC client + config; implement the login/callback/refresh (§4). *(RepoYeti already has
      this — copy it for DevWebUI / Reimagine.)*
- [ ] Implement `SyncClient` (`pull`/`push`) against the live store (§5) — via `@lunawerx/locker`
      (vendored until published) or a direct fetch of the §5a contract.
- [ ] Hook the settings choke-point for load/seed/save; use `version`/`baseVersion` (or the SDK's
      auto-merge); define the **syncable-key allowlist** (§6.6).
- [ ] Add the small opt-in Settings control with its four states (§6.8).
- [ ] Test: sign in on app A → change theme → sign in on app B (or app A on a second machine) →
      theme follows. Confirm signed-out behavior is unchanged. Confirm a mid-flight conflict (edit
      on two devices) resolves via the `409`/re-read path without data-loss surprises. Confirm
      `DELETE` (disconnect) clears the remote doc.

---

## 10. Feasibility summary

**Both halves are now essentially free.** Connections is a standard, live OIDC provider with
public-client PKCE and a stable cross-app `sub`, so "Sign in with Connections" needs no custom
identity work — **and the per-user settings store it used to require you to build is now live,
hosted, runtime-verified, and richer than this spec originally called for** (optimistic-concurrency
writes, deep-merge, ETag reads, rate limits, 64 KB cap, version history + restore, three-tier data,
optional schema validation, and GDPR erasure). The only remaining work is a **thin client sync
layer** hooked into each app's existing settings module (mostly the opt-in UI + a syncable-key
allowlist), optionally using the `@lunawerx/locker` SDK (JS) or the raw three-call contract (any
language — §5f). The design is portable: any additional app — a web SPA, a local daemon, or a
**native Rust/Go/C++ desktop app** (§4d loopback) — adopts it by registering its own OAuth
`client_id` (which doubles as its store `appId`) and calling the same contract. The single caveat is
browser CORS for third-party SPAs (§5d) — a one-flip owner change — which does not affect the
desktop/CLI/daemon or native apps (RepoYeti, DevWebUI, Reimagine, SageThumbs 2K, QuickDictate) at all.

---

## Appendix — where the authoritative details live

- **Contract source of truth:** `https://studio.connections.icu/v1/openapi.json` (scheme
  `oauthUserToken`); mirrored into the Connections MCP operator catalog and surfaced in the Studio
  console's Reference tab (`/dev/docs`).
- **Canonical Connections-side developer guide:** `docs/how-to/USE_DATA_LOCKER.md` in the
  Connections repo — the general "how any app stores settings in the locker" how-to (this RepoYeti
  file is the app-integration companion). SDK usage: `packages/connections-locker/README.md`.
- **Connections repo (design + verification record):**
  `docs/todo/jacob-do-me/connections-settings-sync-store.md` (the shipped contract + runtime
  evidence + deliberate deferrals) and `docs/strategy/SETTINGS_SYNC_DATA_LOCKER.md` (product
  strategy, competitive steal-list, the future publishable-key `cnx_pub_` design).
- **Schema:** `services/studio/schema/0015_app_settings.sql` + `0016_app_settings_v2.sql`.
- **Handler:** `services/studio/api/index.mjs` (`handleAppData` / `appDataPrincipal`).
- **Reference SDK:** `packages/connections-locker` (`@lunawerx/locker`, `+/react`).
