/**
 * Process-wide runtime state discovered AFTER the HTTP app is built, plus the live
 * Cloudflare tunnel lifecycle. Kept here (not in the HTTP layer) so both index.ts (boot)
 * and the /api/mode route can start/stop the tunnel and read its URL without an import
 * cycle. The web UI reads the URL at GET /api/status and gets live updates over SSE
 * (`daemon_status`), so the "remote access" panel shows a link/QR the moment it's ready.
 */
import { startTunnel, startNamedTunnel, type TunnelHandle } from "./tunnel.ts";
import { namedTunnel, type RepoYetiConfig } from "./config.ts";
import { broadcast } from "./bus.ts";
import { announce, createRelayIdentity, type RelayIdentity } from "./relay.ts";
import { saveConfig } from "./config.ts";

/**
 * Publish our current public address to the relay, if the owner turned it on.
 *
 * Mints this daemon's signing identity on first use and persists it, so the relay can pin the key
 * and refuse anyone else who later tries to move this id's address. Everything here is best-effort:
 * the relay exists to keep already-sent links working, and it going down must not surface as a
 * failure in a tool that manages local repositories perfectly well without it.
 */
export async function publishToRelay(cfg: RepoYetiConfig, origin: string): Promise<void> {
  const relay = cfg.relay;
  if (!relay?.enabled || !relay.url?.trim()) return;
  let identity: RelayIdentity | undefined = relay.identity;
  if (!identity) {
    identity = createRelayIdentity();
    cfg.relay = { ...relay, identity };
    try {
      saveConfig(cfg);
    } catch {
      /* an unwritable config shouldn't stop us announcing this session */
    }
  }
  const res = await announce(relay.url, identity, origin);
  if (!res.ok) console.warn(`repoyeti: relay announce failed — ${res.error}`);
}

let tunnelUrl: string | null = null;
let tunnelHandle: TunnelHandle | null = null;
let tunnelStarting = false;
let serverPort = 0;

/** The port the daemon actually bound (set by index.ts once listening). */
export function setServerPort(port: number): void {
  serverPort = port;
}

export function getTunnelUrl(): string | null {
  return tunnelUrl;
}

/** True once a tunnel is up or in the middle of coming up. */
export function tunnelActive(): boolean {
  return tunnelHandle !== null || tunnelStarting;
}

/**
 * Start the Cloudflare tunnel (idempotent). The URL arrives asynchronously: it's broadcast over SSE
 * and exposed at /api/status when the tunnel is ready. `cfg` selects the flavour — a NAMED tunnel
 * (stable host) when `tunnel.hostname` + a token are configured, else the default QUICK tunnel.
 * `onReady` lets the CLI print the URL (with a QR) without coupling this module to the terminal.
 */
export function startManagedTunnel(cfg: RepoYetiConfig, onReady?: (url: string) => void): void {
  if (tunnelHandle || tunnelStarting || !serverPort) return;
  tunnelStarting = true;
  const onUrl = (url: string): void => {
    tunnelUrl = url;
    tunnelStarting = false;
    onReady?.(url);
    broadcast("daemon_status", { tunnelUrl: url, tunnelActive: true });
    // Tell the relay where we moved to, if the owner opted in. This is the moment that matters:
    // a quick tunnel hands out a NEW hostname here, which is exactly when every share link already
    // sent would otherwise go dead. Best-effort and non-blocking — the relay is a convenience, and
    // a failure to reach it must never affect local git management.
    void publishToRelay(cfg, url);
  };
  const onErr = (msg: string): void => {
    tunnelStarting = false;
    tunnelHandle = null;
    broadcast("daemon_status", { tunnelUrl: null, tunnelActive: false, error: msg });
  };
  const named = namedTunnel(cfg);
  tunnelHandle = named
    ? startNamedTunnel(named.token, named.hostname, onUrl, onErr)
    : startTunnel(serverPort, onUrl, onErr);
}

/** Tear the tunnel down (idempotent) and tell clients it's gone. */
export function stopManagedTunnel(): void {
  tunnelHandle?.stop();
  tunnelHandle = null;
  tunnelStarting = false;
  tunnelUrl = null;
  broadcast("daemon_status", { tunnelUrl: null, tunnelActive: false });
}
