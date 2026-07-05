/**
 * "Sync my settings with Connections" — the daemon-side Backend-for-Frontend (BFF).
 *
 * RepoYeti is a single-user local daemon, so the daemon IS the BFF (docs/CONNECTIONS_SETTINGS_SYNC.md
 * §4c): it holds the owner's Connections `refresh_token` server-side (OS keychain), mints fresh
 * access tokens as needed, and calls the settings-sync store
 * (`studio.connections.icu/v1/app-data/{clientId}`) server-to-server through the shared
 * `@lunawerx/locker` client (src/connections-locker.mjs). The browser never holds a token and there
 * is no third-party-browser CORS to worry about — the call is same-process.
 *
 * What syncs: a small ALLOWLIST of portable settings — the web's appearance blob (theme/accent) and
 * a curated set of operational toggles. NEVER machine-specific or secret values (roots, ports,
 * access mode, AI keys, tunnel token, the API token). See PREF_KEYS below.
 *
 * Off by default and additive: with `cfg.cloudSync.enabled` false (the default) nothing here runs.
 */
import { createLocker, type LockerClient } from "./connections-locker.mjs";
import {
  saveConfig,
  type RepoYetiConfig,
  type OAuthConfig,
  type CloudSyncConfig,
} from "./config.ts";
import { getSecret, setSecret, deleteSecret, CONNECTIONS_REFRESH_TOKEN } from "./secrets.ts";
import { broadcast } from "./bus.ts";

/** App-tier document we store (namespaced by the store itself as (sub, clientId), so no inner key). */
interface SyncDoc {
  /** Allowlisted daemon prefs (see PREF_KEYS). */
  prefs?: Record<string, unknown>;
  /** The web's portable appearance (theme/accent) — opaque to the daemon; the web reads/writes it. */
  appearance?: Record<string, unknown>;
}

/**
 * The ONLY daemon-config keys that sync. Deliberately excludes machine-specific state (roots,
 * servers, port, maxDepth, maxRepos), the security-relevant access `mode`, unattended-action master
 * toggles (`autoCommit`, `autoCommitPush` — a fresh machine must not start pushing on its own), and
 * every secret (oauth, tunnel, ai keys, apiToken). What's left is portable UI/behaviour preference.
 */
const PREF_KEYS = [
  "diffStats",
  "remoteEditing",
  "diffPatchBytes",
  "diffPatchEnabled",
  "syncCheck",
  "syncIntervalSecs",
  "keepInSync",
  "autoCommitMode",
  "autoCommitIntervalSecs",
  "autoCommitAt",
  "autoCommitPull",
  "autoScan",
] as const satisfies readonly (keyof RepoYetiConfig)[];

// ── in-memory token state (the refresh token also persists in the keychain) ──────
let accessToken: string | null = null;
let accessTokenExpMs = 0;
let refreshToken: string | null = null;
let loaded = false;

// token_endpoint discovery, cached per issuer.
let discoveryCache: { issuer: string; tokenEndpoint: string } | null = null;

/** Load the persisted refresh token from the keychain into memory. Call once at daemon boot. */
export async function initCloudSync(): Promise<void> {
  if (loaded) return;
  loaded = true;
  refreshToken = await getSecret(CONNECTIONS_REFRESH_TOKEN);
}

/** True when the daemon holds a Connections credential it can sync with (a refresh or access token). */
export function hasConnection(): boolean {
  return !!(refreshToken || accessToken);
}

/**
 * Retain the token set from a successful "Sign in with Connections" (wired via auth.ts `onTokens`).
 * The refresh token is the durable BFF credential → keychain; the access token stays in memory.
 */
export async function rememberTokens(
  tokens: { access_token?: string; refresh_token?: string; expires_in?: number },
): Promise<void> {
  if (tokens.access_token) {
    accessToken = tokens.access_token;
    accessTokenExpMs = Date.now() + Math.max(0, (tokens.expires_in ?? 3600) - 60) * 1000;
  }
  if (tokens.refresh_token) {
    refreshToken = tokens.refresh_token;
    await setSecret(CONNECTIONS_REFRESH_TOKEN, tokens.refresh_token);
  }
  loaded = true;
}

/** Forget the Connections connection entirely (memory + keychain). Used by "disconnect" / sign-out-all. */
export async function clearTokens(): Promise<void> {
  accessToken = null;
  accessTokenExpMs = 0;
  refreshToken = null;
  await deleteSecret(CONNECTIONS_REFRESH_TOKEN);
}

async function tokenEndpoint(oauth: OAuthConfig): Promise<string> {
  const iss = oauth.issuer.replace(/\/$/, "");
  if (discoveryCache?.issuer === iss) return discoveryCache.tokenEndpoint;
  const res = await fetch(`${iss}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  const doc = (await res.json()) as { token_endpoint?: string };
  if (!doc.token_endpoint) throw new Error("OIDC discovery: no token_endpoint");
  discoveryCache = { issuer: iss, tokenEndpoint: doc.token_endpoint };
  return doc.token_endpoint;
}

/** Mint a fresh access token from the refresh token (public PKCE client). Rotates the refresh token
 *  if the IdP returns a new one. Throws if there is no refresh token to spend. */
async function refresh(oauth: OAuthConfig): Promise<string> {
  if (!refreshToken) throw new Error("not_signed_in");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: oauth.clientId,
  });
  if (oauth.clientSecret) body.set("client_secret", oauth.clientSecret);
  const res = await fetch(await tokenEndpoint(oauth), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // A dead/revoked refresh token can never recover — drop it so the UI shows "signed out".
    if (res.status === 400 || res.status === 401) await clearTokens();
    throw new Error(`token refresh failed: ${res.status}`);
  }
  const tok = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tok.access_token) throw new Error("token refresh: no access_token");
  accessToken = tok.access_token;
  accessTokenExpMs = Date.now() + Math.max(0, (tok.expires_in ?? 3600) - 60) * 1000;
  if (tok.refresh_token && tok.refresh_token !== refreshToken) {
    refreshToken = tok.refresh_token;
    await setSecret(CONNECTIONS_REFRESH_TOKEN, tok.refresh_token);
  }
  return accessToken;
}

/** A valid access token, refreshing if the cached one is missing/expired. Throws if not signed in. */
async function getAccessToken(oauth: OAuthConfig): Promise<string> {
  if (accessToken && Date.now() < accessTokenExpMs) return accessToken;
  return refresh(oauth);
}

function lockerFor(oauth: OAuthConfig): LockerClient {
  return createLocker({ appId: oauth.clientId, getToken: () => getAccessToken(oauth) });
}

// ── settings mapping (the allowlist) ─────────────────────────────────────────────
function collectPrefs(cfg: RepoYetiConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PREF_KEYS) {
    const v = cfg[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Apply an allowlisted prefs blob onto the live config (persisted). Ignores any key not on the
 *  allowlist, so a doc written by a newer/older app version can never inject arbitrary config. */
function applyPrefs(cfg: RepoYetiConfig, prefs: Record<string, unknown> | undefined): void {
  if (!prefs || typeof prefs !== "object") return;
  for (const k of PREF_KEYS) {
    if (k in prefs) {
      // Trusted-shape assignment: each key's type is fixed by RepoYetiConfig; the store only ever
      // holds values this same allowlist wrote.
      (cfg as unknown as Record<string, unknown>)[k] = prefs[k];
    }
  }
}

function ensureBlock(cfg: RepoYetiConfig): CloudSyncConfig {
  if (!cfg.cloudSync) cfg.cloudSync = {};
  return cfg.cloudSync;
}

// ── public sync operations ───────────────────────────────────────────────────────

export interface SyncStatus {
  enabled: boolean;
  /** The daemon holds a Connections credential (owner has signed in). */
  connected: boolean;
  lastSyncedAt: string | null;
  version: number;
  /** The last-synced appearance blob so a fresh web load can apply the synced look immediately. */
  appearance: Record<string, unknown> | null;
}

export function syncStatus(cfg: RepoYetiConfig): SyncStatus {
  const b = cfg.cloudSync ?? {};
  return {
    enabled: b.enabled === true,
    connected: hasConnection(),
    lastSyncedAt: b.lastSyncedAt ?? null,
    version: b.version ?? 0,
    appearance: b.appearance ?? null,
  };
}

/** Push the current allowlisted settings to the store (deep-merge — race-free per key). */
export async function pushNow(cfg: RepoYetiConfig, oauth: OAuthConfig): Promise<void> {
  const b = ensureBlock(cfg);
  const doc: SyncDoc = { prefs: collectPrefs(cfg) };
  if (b.appearance) doc.appearance = b.appearance;
  const res = await lockerFor(oauth).merge(doc as Record<string, unknown>);
  b.version = res.version;
  b.lastSyncedAt = new Date().toISOString();
  saveConfig(cfg);
}

/** Pull the remote settings and apply the allowlisted subset locally. Returns whether anything was
 *  applied (a never-written remote doc has version 0 and applies nothing). */
export async function pullNow(cfg: RepoYetiConfig, oauth: OAuthConfig): Promise<{ applied: boolean; version: number }> {
  const b = ensureBlock(cfg);
  const remote = await lockerFor(oauth).get();
  const data = (remote.settings ?? {}) as SyncDoc;
  b.version = remote.version;
  if (remote.version > 0) {
    applyPrefs(cfg, data.prefs);
    if (data.appearance && typeof data.appearance === "object") b.appearance = data.appearance;
    b.lastSyncedAt = new Date().toISOString();
    saveConfig(cfg);
    // Tell every connected client to re-read status/appearance. Daemon runtime flags that are
    // primed at boot pick up the pulled config on the next start; the appearance applies live.
    broadcast("settings_changed", { cloudSync: true });
    return { applied: true, version: remote.version };
  }
  saveConfig(cfg);
  return { applied: false, version: remote.version };
}

/** Turn sync on: pull the remote doc (applying it) or, if the remote is empty, seed it from local. */
export async function enable(cfg: RepoYetiConfig, oauth: OAuthConfig, appearance?: Record<string, unknown>): Promise<SyncStatus> {
  const b = ensureBlock(cfg);
  b.enabled = true;
  if (appearance) b.appearance = appearance;
  saveConfig(cfg);
  if (hasConnection()) {
    const pulled = await pullNow(cfg, oauth);
    if (!pulled.applied) await pushNow(cfg, oauth); // remote empty → seed it with our current settings
  }
  return syncStatus(cfg);
}

/** Turn sync off. `forget` also disconnects (clears tokens) and deletes the remote document. */
export async function disable(cfg: RepoYetiConfig, oauth: OAuthConfig, opts: { forget?: boolean } = {}): Promise<SyncStatus> {
  const b = ensureBlock(cfg);
  b.enabled = false;
  if (opts.forget) {
    if (hasConnection()) {
      try {
        await lockerFor(oauth).delete();
      } catch {
        /* best-effort remote wipe — local disconnect proceeds regardless */
      }
    }
    await clearTokens();
    b.version = 0;
    delete b.appearance;
    delete b.lastSyncedAt;
  }
  saveConfig(cfg);
  return syncStatus(cfg);
}

/** The web changed its appearance (theme/accent) while synced — record it and push (if enabled). */
export async function updateAppearance(cfg: RepoYetiConfig, oauth: OAuthConfig, appearance: Record<string, unknown>): Promise<void> {
  const b = ensureBlock(cfg);
  b.appearance = appearance;
  saveConfig(cfg);
  if (b.enabled && hasConnection()) await pushNow(cfg, oauth);
}
