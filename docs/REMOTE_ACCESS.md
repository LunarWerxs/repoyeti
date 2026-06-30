# RepoYeti remote access — `app.repoyeti.com` (runbook + what we built)

> **TL;DR.** RepoYeti is reachable from a phone at **`https://app.repoyeti.com`** via a **named
> Cloudflare tunnel** (not the old rotating, DNS-blocked `*.trycloudflare.com` quick tunnel). The
> tunnel + DNS were provisioned **through the Connections vault** (no raw Cloudflare token ever
> touched this machine). Login is done **the right way** — the daemon registers and uses its **own**
> `/oauth/callback`, and the old redirect "shim" Worker is **deleted**. The Cloudflare layer is
> verified; the only thing not yet runtime-proven is a live end-to-end sign-in (needs the daemon
> running + one real login).

---

## Why we moved off trycloudflare
The quick tunnel gave a **rotating** `*.trycloudflare.com` URL, and that namespace is **widely
DNS-blocked** (it's abused for malware/phishing), so phones on filtered networks got
`DNS_PROBE_FINISHED_NXDOMAIN`. A **named tunnel on our own domain** is stable and resolves everywhere.

## The tunnel (live, verified at the Cloudflare layer)
| Thing | Value |
|---|---|
| Cloudflare account | **`36d7c731fd0352ef08ea7e46d2d20793`** (Lunawerx@gmail.com) — owns the `repoyeti.com` zone (`a71592246b44b2282bd071ae0e8ca095`) |
| Tunnel id | **`ce2ba43f-73f3-49d8-9e89-72d2e419d0bd`** (named `repoyeti`, remotely-managed) |
| Public hostname | `app.repoyeti.com` → `http://localhost:7171` (ingress configured in the tunnel) |
| DNS | proxied CNAME `app.repoyeti.com → ce2ba43f-…​.cfargotunnel.com` |
| Connector | `cloudflared` (2025.8.1, installed) running with the connector token |

**How it was provisioned:** entirely through the **Connections vault** — `connections_execute` against the
Cloudflare catalog endpoints (`cfd_tunnel` create/configure/token, `dns_records` create, `zones` lookup), with
the Cloudflare credential injected server-side, value-blind. See the Connections repo
`docs/architecture/mcp-catalog-executor.md` §7 for the exact mechanism (and the catalog bugs that had to be
fixed first to make it work at all).

**Verified:** the connector registers at Cloudflare's edge (4 QUIC connections) and a request to
`https://app.repoyeti.com` routes through the tunnel to `localhost:7171` (returns 502 only because the daemon
isn't currently listening — which itself proves the ingress is correct).

## Daemon side (code + config)
- **Named-tunnel support** (this was new — the quick tunnel was the only option before):
  `src/tunnel.ts` → `startNamedTunnel()` (`cloudflared tunnel run --token …`, advertises `https://<hostname>`
  on first edge connection); `src/config.ts` → `TunnelConfig` + `namedTunnel()` resolver (token is a keychain
  secret, env override `CF_TUNNEL_TOKEN`); `src/runtime.ts` → `startManagedTunnel(cfg)` picks named vs quick.
- **Config:** `~/.repoyeti/config.json` →
  `"tunnel": { "provider":"named", "hostname":"app.repoyeti.com", "token":"<connector token>" }`.
  The token moves to the OS keychain on boot and is stripped from disk.
- **UI:** the Remote-access modal overflow (long URL pushing the copy button off the card) was a CSS-grid
  `min-width:auto` trap — fixed with `min-w-0` on the link block in `web/src/components/RemoteAccess.vue`.

## Login — the right way (no shim)
The old design used a **rotating** tunnel URL, so OAuth (which needs a fixed registered redirect) used a tiny
"shim" Worker that bounced the login back to the daemon's current address. **With a stable domain that's
obsolete.** Now:
- **IdP registration** (Connections `developer_app_registrations`, clientId `a790090c23b353c15ed973fd5fe20563`):
  `redirect_uris = [ https://app.repoyeti.com/oauth/callback , http://127.0.0.1:7171/oauth/callback ]`.
  (The previous entry was malformed — `…/cb%20and`, old `gitmob-auth` name — and would have failed login.)
- **Daemon** (`src/auth.ts`): `/oauth/login` sends `redirect_uri = <its own origin>/oauth/callback`;
  `/oauth/callback` exchanges with the same value, derived from the **HMAC-signed `state`** (so it can't be
  tampered). The IdP allow-list + the signed origin double-gate against open redirects.
- **Shim retired:** the `gitmob-auth` Worker (it was never re-deployed under the new name) was **deleted** from
  the Lunawerx Cloudflare account. `shim/` in this repo is now dead reference code.

## Headless agents — an optional Bearer API token (no browser needed)
A **remote or headless AI agent** can't complete the browser-based OIDC dance. For that case the
owner can mint an **optional API token** and the agent authenticates with a Bearer header:
- `repoyeti token new` mints + prints the token **once** (`POST /api/auth/token`); `repoyeti token
  revoke` deletes it; `repoyeti token show` reports only whether one is configured.
- Then send `Authorization: Bearer <token>` (or set `REPOYETI_TOKEN` for the CLI verbs and
  `repoyeti mcp`).
- It's a **separate, local credential** (constant-time compared, kept in the OS keychain) — it never
  touches connections.icu and exists only on this daemon.
- **Off by default, and it never weakens the default posture.** When no token is set, auth is
  byte-for-byte the OIDC-only behavior described above; a request over the tunnel still requires a
  signed-in owner *or* the explicit token. The token is purely additive, for the headless case.

## To bring it fully live
1. Run RepoYeti with **remote access on** (it reads `~/.repoyeti/config.json` and runs the named-tunnel
   connector itself; `cloudflared` is installed).
2. **Sign in once** over `app.repoyeti.com` to claim ownership (a request over the tunnel always requires the
   owner session — the security invariant). This is the one step not yet runtime-verified.

## Security notes
- A request arriving over the tunnel **always** requires a signed-in owner, in any mode (loopback can "continue
  local"). Enabling remote refuses until an owner is claimed (no stranger races TOFU on a fresh tunnel).
- The named-tunnel host is a normal `repoyeti.com` record — **not** on any trycloudflare blocklist.

## Open
- **Live sign-in not yet proven** (needs the daemon running). If the IdP rejects the redirect URI, it's an app-
  registration cache TTL — re-try shortly.
- **Google Cloud** (used elsewhere via the operator) still needs a re-connect for a fresh token — unrelated to
  this tunnel; see the Connections doc §8.
- Daemon code edits (`auth.ts`, `config.ts`, `tunnel.ts`, `runtime.ts`) are in the working tree.
