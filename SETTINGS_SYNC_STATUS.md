# Settings sync — status & resume note

_Last updated: 2026-07-03_

Where the "Sync my settings with Connections" feature stands, and what's left to do — so this can be
picked up cold whenever the Connections side is ready. **The whole thing is blocked on one piece:
building a per-user key-value store in Connections. Everything else is designed and, for the login
half, already built.**

## TL;DR

- **Goal:** an optional "Sync settings with Connections" button (small icon in Settings). User signs in
  with their Connections account → their app settings (theme/accent/layout/toggles) sync across machines
  and across the sibling apps (RepoYeti, DevWebUI, Reimagine, + a 4th TBD).
- **Login half:** ✅ already solved. Connections is a live OIDC provider; **RepoYeti already ships
  "Sign in with Connections."**
- **Storage half:** ⛔ the one blocker. Connections has **no generic per-user KV** yet. A small
  `app_settings` store must be built there first (spec written — see below).
- **Order to build:** (1) Connections `app_settings` store → (2) RepoYeti sync layer (reference impl,
  since login already exists) → (3) DevWebUI + Reimagine copy RepoYeti.

## Artifacts already produced (read these to resume)

1. **Portable implementation spec** (generic, hand to any app incl. the 4th):
   [`CONNECTIONS_SETTINGS_SYNC.md`](CONNECTIONS_SETTINGS_SYNC.md) — repo root. Verified Connections OIDC
   facts, the OAuth+PKCE flow, the storage-endpoint contract, client integration, security rules.
2. **Connections work-orders** (in the Connections repo, `docs/todo/`):
   - `jacob-do-me/connections-settings-sync-store.md` — **the store to build** (the blocker). `app_settings`
     table keyed by `(sub, app_id)`, hosted on the myaccount plane, with Art.17 erasure wired from day one.
   - `jacob-do-me/publishable-api-key-tier.md` — related security gap (no public/publishable key tier;
     `allowed_origins`/`allowed_ips` columns exist but are never enforced). Not a blocker for this feature.
   - `michael-do-me/studio-platform-opportunities.md` — broader ideas menu.

## Verified Connections facts (so this is self-contained)

- **OIDC provider:** `accounts.connections.icu` — discovery at `/.well-known/openid-configuration`;
  `authorize` / `token` / `userinfo` / `jwks` under `/oauth/*`; RS256.
- **Public PKCE clients supported** (`token_endpoint_auth_methods` includes `none`) → browser login needs
  no client secret.
- **Same user → same `sub` across every app** (`subject_types: ["public"]`) → `sub` is the cross-app sync key.
- **RepoYeti's registered client_id:** `a790090c23b353c15ed973fd5fe20563` (baked-in public client,
  `openid profile email`, redirect `https://app.repoyeti.com/oauth/callback`).
- **Storage gap:** the only per-user writable objects today are semantic (contacts, events, notes,
  MyConnect) — no arbitrary KV. Hence the `app_settings` store must be built.

## The storage contract this app will call (once the Connections store is live)

```
GET  /v1/app-data/{appId}   Authorization: Bearer <user token>
     → { settings: {...}, version: N }        (version 0 / {} if nothing stored yet)
PUT  /v1/app-data/{appId}   body: { settings: {...}, baseVersion: N }
     → { version: N+1 }   or 409 (+ current state) if baseVersion is stale
DELETE /v1/app-data/{appId} → forget this app's settings for this user
```
`appId` comes from the token's own `client_id`; `sub` from the verified token. The app never holds any
`cnx_live_` key — only the end-user's own OIDC token.

## RepoYeti-specific integration plan (do this once the Connections store exists)

RepoYeti is a local Bun/Hono daemon + Vue PWA. The daemon is the natural BFF — it already does OIDC and
can hold the refresh token server-side. What's left:

1. **Retain the Connections token.** RepoYeti's login (`src/auth.ts`) establishes the owner identity but
   stores only `ownerSub`/`ownerEmail`. To sync, keep the refresh token server-side (OS keychain via
   `src/secrets.ts`, same place other secrets live) so the daemon can mint access tokens to call the store.
2. **Add a sync route** in the Hono app — new `src/http/routes/settings-sync.ts` (mirror an existing route
   module; register one line in `src/http/app.ts`). It pulls/pushes the settings blob to `/v1/app-data/{clientId}`
   server-to-server, then applies results via the existing `saveConfig()` + `settings_changed` SSE broadcast.
   The existing settings write choke-point is `PUT /api/settings` in `src/http/routes/health.ts`.
3. **Decide the syncable-key allowlist.** Sync portable prefs only. Candidates:
   - From `RepoYetiConfig` (`src/config.ts`): `mode`, `diffStats`, `remoteEditing`, `diffPatch*`, `syncCheck`,
     `autoScan`, etc. **Never sync secrets** (AI provider keys, OAuth `clientSecret`, tunnel token, `apiToken`
     — already keychain-only) and **never sync machine-specific** values (`roots` absolute paths, `port`).
   - The 3 client-only localStorage prefs (theme `vueuse-color-scheme`, `repoyeti:changesView*`,
     `repoyeti.desktopNotify`) — decide whether to fold these into the synced blob (they're not in
     `config.json` today).
4. **Add the button** in `web/src/components/settings/IdentityAccessSection.vue`, next to the existing
   Connections signed-in-account card. States: signed-out (offer sync) → syncing → "Synced ✓" + stop-syncing.
5. **Conflict policy:** last-write-wins by version; on a `409`, pull current and merge (remote wins per key)
   with a small "updated from another device" note.

## Resume checklist

- [ ] Build the Connections `app_settings` store (see the Connections work-order) — **the blocker**.
- [ ] Verify it live: `GET/PUT/DELETE /v1/app-data/{appId}` round-trips with a real RepoYeti sign-in token.
- [ ] Wire RepoYeti (steps 1–5 above) as the reference implementation.
- [ ] Port to DevWebUI and Reimagine (both are local daemons too; DevWebUI/Reimagine need the login half
      added first — copy RepoYeti's `src/auth.ts` pattern). Use `CONNECTIONS_SETTINGS_SYNC.md` §4c.
- [ ] (Optional) rotate the `cnx_live_` dev key that was shared during this investigation.
