/**
 * Type declarations for connections-locker.mjs — the Connections data-locker client.
 * See connections-locker.mjs for the full contract + rate-limit / size notes.
 */

export type LockerSettings = Record<string, unknown>;

export interface LockerDocument {
  app_id: string;
  /** The user-writable tier — what set()/merge() writes. */
  settings: LockerSettings;
  /** The app-backend-written, user-READABLE tier (entitlements, plan, credits). Read-only here. */
  server_settings: LockerSettings;
  version: number;
  updated_at: string | null;
  bytes_used: number;
  max_bytes: number;
}

export interface LockerVersion {
  version: number;
  replaced_at: string;
  bytes: number;
}

export interface LockerClientOptions {
  /** Your app's OAuth client_id (the one your Sign-in-with-Connections client uses). */
  appId: string;
  /** Returns the CURRENT signed-in user's access token (refresh-aware). */
  getToken: () => string | Promise<string>;
  /** Override the store base URL (defaults to https://studio.connections.icu). */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class LockerError extends Error {
  name: "LockerError";
  status: number;
  code: string;
  retryAfterSeconds?: number;
  violations?: string[];
  constructor(status: number, code: string, message: string, extra?: { retryAfterSeconds?: number; violations?: string[] });
}

export class LockerClient {
  constructor(options: LockerClientOptions);
  /** Read the user's document (ETag/304-cached). */
  get(): Promise<LockerDocument>;
  /** Replace the whole user-tier document (auto-merges on a 409, ≤3 tries). */
  set(
    settings: LockerSettings,
    options?: { onConflict?: (current: LockerSettings, mine: LockerSettings) => LockerSettings },
  ): Promise<LockerDocument>;
  /** Deep-merge a partial update (RFC 7386 — null deletes a key). */
  merge(partial: LockerSettings): Promise<LockerDocument>;
  /** Forget this app's data for the user (document + history). Idempotent. */
  delete(): Promise<void>;
  /** The last ≤20 replaced versions (rollback candidates). */
  versions(): Promise<LockerVersion[]>;
  /** Restore a version as a new write. */
  restore(version: number): Promise<LockerDocument>;
}

export function createLocker(options: LockerClientOptions): LockerClient;
