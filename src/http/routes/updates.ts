import type { Hono } from "hono";
import type { Deps } from "../deps.ts";
import { applyUpdate, checkForUpdate } from "../../updater.ts";
import { trackAnalyticsEvent } from "../../analytics.ts";
import { jsonError } from "../../contract.ts";

export function register(app: Hono, { cfg }: Deps): void {
  app.get("/api/updates", async (c) => {
    const status = await checkForUpdate();
    void trackAnalyticsEvent(cfg, "update_check", {
      available: status.updateAvailable,
      canApply: status.canApply,
      reason: status.reason,
    });
    return c.json(status);
  });

  app.post("/api/updates/apply", async (c) => {
    void trackAnalyticsEvent(cfg, "update_apply_clicked");
    try {
      const result = await applyUpdate();
      void trackAnalyticsEvent(cfg, "update_apply_result", {
        ok: result.ok,
        restartRequired: result.restartRequired,
      });
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      void trackAnalyticsEvent(cfg, "update_apply_result", { ok: false, message });
      return jsonError(c, "ERROR", message);
    }
  });
}
