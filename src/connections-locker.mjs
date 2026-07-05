/**
 * connections-locker — the Connections "data locker" client (server-side, framework-agnostic).
 *
 * A "Sign in with Connections" app stores ONE small (≤64 KB) JSON settings/state document per
 * signed-in user, server-side, with no backend of its own. The document follows the user across
 * devices and apps (the OIDC `sub` is the cross-device key). The service enforces isolation by
 * construction: your app's token can only ever reach its own users' documents — there are no
 * security rules to configure and none to forget.
 *
 * This is the runtime-agnostic port of `@lunawerx/locker` (pure `fetch`, no dependencies), shipped
 * in the shared kit so every LunarWerx daemon (RepoYeti / DevWebUI / Reimagine …) calls the store
 * through ONE audited client. Each app is its OWN registered OAuth app, so it passes its OWN
 * `appId` (= its OAuth `client_id`) and its OWN user token — the store namespaces the document by
 * (verified `sub`, `app_id`), so the apps never collide even though they share this code.
 *
 * Contract (https://studio.connections.icu/v1/openapi.json — scheme `oauthUserToken`):
 *   GET    /v1/app-data/{appId}            → { app_id, settings, server_settings, version, updated_at, bytes_used, max_bytes }  (ETag = "<version>")
 *   POST   /v1/app-data/{appId}            → body { settings, baseVersion, merge? }  (409 → { error, current:{settings,version} })
 *   DELETE /v1/app-data/{appId}            → 204 (forget the doc + its history)
 *   GET    /v1/app-data/{appId}/versions   → { versions: [ { version, replaced_at, bytes } ] }  (last ≤20)
 *   POST   /v1/app-data/{appId}/restore    → body { version }
 *
 * Rate limits: 120 writes/min + 1,800/hr per (user, app) — a 429 carries `retry_after_seconds`.
 * The user-tier document is ≤ 64 KB; a bigger write returns 413 `settings_too_large`.
 * NOT a secure vault (no secrets/PII), NOT blob storage — portable settings + small state only.
 *
 * @typedef {Record<string, unknown>} LockerSettings
 */

/** A structured store error. `code` is the server's named error (`version_conflict`,
 *  `settings_too_large`, `schema_violation`, `rate_limited`, `app_mismatch`, `not_authenticated`, …). */
export class LockerError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {{ retryAfterSeconds?: number, violations?: string[] }} [extra]
   */
  constructor(status, code, message, extra) {
    super(message);
    this.name = "LockerError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = extra?.retryAfterSeconds;
    this.violations = extra?.violations;
  }
}

export class LockerClient {
  /** @param {{ appId: string, getToken: () => string | Promise<string>, baseUrl?: string, fetch?: typeof fetch }} options */
  constructor(options) {
    this.appId = options.appId;
    this.getToken = options.getToken;
    this.baseUrl = (options.baseUrl ?? "https://studio.connections.icu").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    /** @type {{ doc: any, etag: string } | null} */
    this.cache = null;
  }

  /** @param {string} [subPath] */
  url(subPath = "") {
    return `${this.baseUrl}/v1/app-data/${encodeURIComponent(this.appId)}${subPath}`;
  }

  /** @param {string} subPath @param {RequestInit & { headers?: Record<string,string> }} [init] */
  async request(subPath, init = {}) {
    const token = await this.getToken();
    return this.fetchImpl(this.url(subPath), {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  }

  /** @param {Response} res @returns {Promise<LockerError>} */
  static async toError(res) {
    const body = await res.json().catch(() => ({}));
    const code = typeof body.error === "string" ? body.error : `http_${res.status}`;
    return new LockerError(res.status, code, typeof body.hint === "string" ? body.hint : code, {
      retryAfterSeconds: typeof body.retry_after_seconds === "number" ? body.retry_after_seconds : undefined,
      violations: Array.isArray(body.violations) ? body.violations : undefined,
    });
  }

  /** Read the user's document. Conditional (ETag/304) — an unchanged doc costs no re-download. */
  async get() {
    const res = await this.request("", {
      method: "GET",
      headers: this.cache ? { "if-none-match": this.cache.etag } : {},
    });
    if (res.status === 304 && this.cache) return this.cache.doc;
    if (!res.ok) throw await LockerClient.toError(res);
    const doc = await res.json();
    this.cache = { doc, etag: res.headers.get("etag") ?? `"${doc.version}"` };
    return doc;
  }

  /**
   * Replace the whole user-tier document. On a version conflict the server's current doc is passed
   * to `onConflict` (default: retry with the caller's doc on top of the server version), ≤3 tries.
   * @param {LockerSettings} settings
   * @param {{ onConflict?: (current: LockerSettings, mine: LockerSettings) => LockerSettings }} [options]
   */
  async set(settings, options = {}) {
    return this.write(settings, false, options.onConflict);
  }

  /**
   * Deep-merge a partial update (RFC 7386: null deletes a key, nested objects merge, arrays and
   * scalars replace). The natural way to save one changed setting without racing other devices.
   * @param {LockerSettings} partial
   */
  async merge(partial) {
    return this.write(partial, true);
  }

  /**
   * @param {LockerSettings} payload
   * @param {boolean} mergeMode
   * @param {(current: LockerSettings, mine: LockerSettings) => LockerSettings} [onConflict]
   */
  async write(payload, mergeMode, onConflict) {
    let base = this.cache?.doc.version ?? (await this.get()).version;
    let body = payload;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await this.request("", {
        method: "POST",
        body: JSON.stringify({ settings: body, baseVersion: base, ...(mergeMode ? { merge: true } : {}) }),
      });
      if (res.ok) {
        this.cache = null; // next get() refetches the authoritative doc
        return this.get();
      }
      if (res.status === 409) {
        const conflict = await res.json().catch(() => ({}));
        base = conflict.current?.version ?? 0;
        if (!mergeMode) body = (onConflict ?? ((_current, mine) => mine))(conflict.current?.settings ?? {}, payload);
        continue; // merge-mode retries as-is: the server re-applies the patch onto the fresh doc
      }
      throw await LockerClient.toError(res);
    }
    throw new LockerError(409, "version_conflict", "Gave up after 3 conflicting writes — another device is writing continuously.");
  }

  /** Forget this app's data for the user (document + history). Idempotent. */
  async delete() {
    const res = await this.request("", { method: "DELETE" });
    if (!res.ok && res.status !== 204) throw await LockerClient.toError(res);
    this.cache = null;
  }

  /** The last ≤20 replaced versions (rollback candidates). */
  async versions() {
    const res = await this.request("/versions", { method: "GET" });
    if (!res.ok) throw await LockerClient.toError(res);
    const body = await res.json();
    return body.versions;
  }

  /** Restore a version from versions() as a NEW write (normal rate limits apply). @param {number} version */
  async restore(version) {
    const res = await this.request("/restore", { method: "POST", body: JSON.stringify({ version }) });
    if (!res.ok) throw await LockerClient.toError(res);
    this.cache = null;
    return this.get();
  }
}

/** @param {{ appId: string, getToken: () => string | Promise<string>, baseUrl?: string, fetch?: typeof fetch }} options */
export function createLocker(options) {
  return new LockerClient(options);
}
