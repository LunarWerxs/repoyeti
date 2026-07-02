import type { Hono } from "hono";
import type { Deps } from "../deps.ts";
import { trackAnalyticsEvent } from "../../analytics.ts";

export function register(app: Hono, { cfg }: Deps): void {
  app.post("/api/analytics/events", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await trackAnalyticsEvent(cfg, String(body.event ?? ""), body.properties);
    return c.json(result, result.ok ? 200 : 400);
  });
}
