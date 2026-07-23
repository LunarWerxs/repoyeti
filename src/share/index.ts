/**
 * Share links — the guest principal.
 *
 * The owner hands someone a secret URL; that URL, and nothing else, is the credential. This is the
 * one place in RepoYeti where a caller who is NOT the trusted Connections owner can reach the
 * daemon at all, so the whole module is written to be read by someone deciding whether to trust it.
 *
 * ── The credential ─────────────────────────────────────────────────────────────
 * A link's secret is 32 random bytes (256 bits, `randomBytes` — a CSPRNG). Redemption consults only
 * sha256(secret), while the plaintext is retained separately so the owner can copy the same link
 * later. That means:
 *   • Guessing is not a threat model. Rate-limiting a 256-bit space would be security theatre.
 *   • repoyeti.db IS bearer-sensitive: its retained tokens are working share links. This is an
 *     explicit owner tradeoff for Copy link; settings sync never sends the database or secrets.
 *   • Revocation clears the retained plaintext. Rows minted before retention have none and must be
 *     re-keyed before the panel can offer a copyable URL.
 *
 * ── Why redemption swaps the token for a cookie ────────────────────────────────
 * GET /s/<secret> validates the secret once, then sets a signed cookie and redirects. The token
 * therefore appears in exactly one URL, once, instead of riding on every subsequent request where
 * it would land in Referer headers, proxy logs, and the SPA's own history entries.
 *
 * ── Why the cookie is NOT self-sufficient ──────────────────────────────────────
 * The cookie carries only a share id, and EVERY request re-reads that share from SQLite. It would
 * be cheaper to stuff perm/scope into the signed cookie and skip the lookup — and it would be
 * wrong: a stateless cookie cannot be revoked, and "revoke this link right now" is the entire
 * reason the owner will trust the feature. Revocation is a single UPDATE that takes effect on the
 * guest's very next request. The lookup is an indexed read against a local SQLite file.
 */
import { randomBytes, createHash } from "node:crypto";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, unsign } from "../signing.ts";
import { getShare, getShareByTokenHash, touchShare, type Share } from "../db.ts";

/** The guest cookie. Distinct from the owner's `gm_session` so the two can never be confused. */
export const GUEST_COOKIE = "ry_share";

/**
 * How long a redeemed cookie lasts before the guest must re-open the link. Independent of (and
 * always capped by) the share's own expiry, which is enforced on every request regardless.
 */
const GUEST_COOKIE_TTL_MS = 12 * 3600 * 1000;

/** Preset link lifetimes the owner picks from. `null` = never expires. */
export const SHARE_DURATIONS = {
  hour: 3600 * 1000,
  day: 24 * 3600 * 1000,
  week: 7 * 24 * 3600 * 1000,
  month: 30 * 24 * 3600 * 1000,
  year: 365 * 24 * 3600 * 1000,
  never: null,
} as const;

export type ShareDuration = keyof typeof SHARE_DURATIONS;

/** Resolve a preset to an absolute expiry (ms), or null for "never". */
export function expiryFor(duration: ShareDuration, now = Date.now()): number | null {
  const ms = SHARE_DURATIONS[duration];
  return ms === null ? null : now + ms;
}

/** Mint a link secret. The caller stores both it and its hash; redemption consults the hash only. */
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 of a presented secret, hex. The only form redemption ever looks up. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A share is usable when it is neither revoked nor past its expiry. */
export function shareIsLive(s: Share, now = Date.now()): boolean {
  if (s.revokedAt !== null) return false;
  if (s.expiresAt !== null && s.expiresAt <= now) return false;
  return true;
}

/**
 * Exchange a link secret for its share. Returns null for unknown, revoked, or expired tokens
 * alike — the caller must not tell a guest which, since "this link was revoked" confirms a valid
 * link once existed.
 */
export function redeemToken(token: string): Share | null {
  if (!token) return null;
  const s = getShareByTokenHash(hashToken(token));
  if (!s || !shareIsLive(s)) return null;
  touchShare(s.id);
  return s;
}

/** Set the guest cookie after a successful redemption. */
export function setGuestCookie(c: Context, share: Share, secure: boolean): void {
  // Never outlive the share itself: a 1-hour link must not leave a 12-hour cookie behind.
  const ttl = share.expiresAt === null
    ? GUEST_COOKIE_TTL_MS
    : Math.min(GUEST_COOKIE_TTL_MS, Math.max(0, share.expiresAt - Date.now()));
  setCookie(c, GUEST_COOKIE, sign(JSON.stringify({ sid: share.id, exp: Date.now() + ttl })), {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    path: "/",
    maxAge: Math.floor(ttl / 1000),
  });
}

export function clearGuestCookie(c: Context): void {
  deleteCookie(c, GUEST_COOKIE, { path: "/" });
}

/**
 * The share behind this request's guest cookie, or null.
 *
 * Two independent things must hold, and both are checked every call: the cookie's HMAC must verify
 * (so a guest cannot forge a share id or extend their own cookie), AND the share must still be live
 * in the database (so revocation and expiry bite immediately, not whenever a cookie happens to
 * lapse). A revoked share fails here on the guest's next request, which is the point.
 */
export function readGuestShare(c: Context): Share | null {
  const raw = unsign(getCookie(c, GUEST_COOKIE));
  if (!raw) return null;
  try {
    const { sid, exp } = JSON.parse(raw) as { sid?: string; exp?: number };
    if (!sid || !exp || exp < Date.now()) return null;
    const s = getShare(sid);
    if (!s || !shareIsLive(s)) return null;
    return s;
  } catch {
    return null;
  }
}

/**
 * Has this link's address moved out from under it?
 *
 * A zero-config quick tunnel re-hosts itself on every restart, so a link minted against the old
 * hostname stops resolving — silently, on the RECIPIENT's end. Comparing the origin recorded at
 * mint against where we live now is what lets the owner be told instead of finding out from the
 * person they sent it to.
 *
 * Returns false whenever we cannot know: no recorded origin (the link predates the record), or no
 * live origin (no tunnel up). "We don't know where we live" is NOT the same as "we moved", and
 * flagging every link the moment remote access is off would be noise, not a warning.
 */
export function isStaleOrigin(shareOrigin: string | null, liveOrigin: string | null): boolean {
  if (!shareOrigin || !liveOrigin) return false;
  return normalizeOrigin(shareOrigin) !== normalizeOrigin(liveOrigin);
}

/** Trailing slashes and case differences are not a change of address. */
function normalizeOrigin(u: string): string {
  return u.trim().replace(/\/+$/, "").toLowerCase();
}
