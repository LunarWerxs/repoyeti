import { test, expect } from "bun:test";
import { createApp } from "../src/http/app.ts";
import type { RepoYetiConfig } from "../src/config.ts";

// Local mode (no OIDC) → /api/* is not gated, so we can exercise the AI routes directly.
const localCfg = (): RepoYetiConfig => ({ roots: [], port: 7171, maxDepth: 6, maxRepos: 200 });

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("GET /api/ai/settings starts with no configured AI provider", async () => {
  const res = await createApp(localCfg()).request("/api/ai/settings");
  expect(res.status).toBe(200);
  const j = await res.json();
  expect(j.defaultProvider).toBeNull();
  expect(j.providers.groq).toBeUndefined();
  expect(j.style).toBe("conventional");
  expect(JSON.stringify(j)).not.toContain("apiKey");
});

test("connect with an empty key is rejected before any network call", async () => {
  const res = await post(createApp(localCfg()), "/api/ai/providers/openai/connect", {});
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe("NO_KEY");
});

test("connect to an unknown provider → 404 BAD_PROVIDER", async () => {
  const res = await post(createApp(localCfg()), "/api/ai/providers/bogus/connect", { apiKey: "x" });
  expect(res.status).toBe(404);
  expect((await res.json()).code).toBe("BAD_PROVIDER");
});

test("commit-message refuses to run until an AI provider is configured", async () => {
  const res = await post(createApp(localCfg()), "/api/repos/whatever/commit-message", {});
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe("NO_AI_PROVIDER");
});

test("setting a default provider that has no key is refused", async () => {
  const res = await createApp(localCfg()).request("/api/ai/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ defaultProvider: "openai" }),
  });
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe("NOT_CONFIGURED");
});
