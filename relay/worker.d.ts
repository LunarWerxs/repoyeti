/**
 * Types for relay/worker.js so the daemon's test suite can import it directly.
 *
 * The Worker is authored as plain JS because that's what deploys to Cloudflare with no build step —
 * fewer moving parts for a service whose whole appeal is that it is boring. This file exists only
 * so `tests/relay-worker.test.ts` can exercise the real thing under typecheck.
 */
export interface RelayKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface RelayEnv {
  RELAY: RelayKv;
}

declare const worker: {
  fetch(request: Request, env: RelayEnv): Promise<Response>;
};

export default worker;
