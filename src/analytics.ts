import { randomUUID } from "node:crypto";
import { VERSION, type RepoYetiConfig, saveConfig } from "./config.ts";

export interface AnalyticsResult {
  ok: boolean;
  enabled: boolean;
  status?: number;
  error?: string;
}

function endpoint(cfg: RepoYetiConfig): string | null {
  const configured = cfg.analytics?.endpoint?.trim() || process.env.CONNECTIONS_ANALYTICS_URL?.trim();
  return configured || null;
}

function disabled(cfg: RepoYetiConfig): boolean {
  const env = (process.env.REPOYETI_ANALYTICS ?? process.env.CONNECTIONS_ANALYTICS ?? "").trim().toLowerCase();
  return cfg.analytics?.enabled === false || env === "0" || env === "false" || env === "off";
}

function installId(cfg: RepoYetiConfig): string {
  cfg.analytics ??= {};
  if (!cfg.analytics.installId) {
    cfg.analytics.installId = randomUUID();
    saveConfig(cfg);
  }
  return cfg.analytics.installId;
}

function cleanProperties(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(key)) continue;
    if (
      value == null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }
  return out;
}

export async function trackAnalyticsEvent(
  cfg: RepoYetiConfig,
  event: string,
  properties?: unknown,
): Promise<AnalyticsResult> {
  const url = endpoint(cfg);
  if (disabled(cfg) || !url) return { ok: true, enabled: false };
  const name = String(event || "").trim();
  if (!/^[a-zA-Z0-9_.:-]{1,120}$/.test(name)) return { ok: false, enabled: true, error: "invalid event" };

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = process.env.CONNECTIONS_ANALYTICS_TOKEN?.trim();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "connections",
        app: "repoyeti",
        version: VERSION,
        installId: installId(cfg),
        event: name,
        properties: cleanProperties(properties),
        ts: new Date().toISOString(),
      }),
    });
    return { ok: res.ok, enabled: true, status: res.status };
  } catch (e) {
    return { ok: false, enabled: true, error: e instanceof Error ? e.message : String(e) };
  }
}
