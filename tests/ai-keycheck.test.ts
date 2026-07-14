/**
 * checkAiKeys (src/ai-keycheck.ts) — startup AI-key liveness probe. Fetch is injected so no real
 * provider is hit: an owner key that 401s broadcasts `ai_key_invalid` and is tracked in
 * invalidAiKeys(); a valid key and a no-keys config broadcast nothing.
 */
import { test, expect } from "bun:test";
import { checkAiKeys, invalidAiKeys } from "../src/ai-keycheck.ts";
import { addListener, removeListener } from "../src/bus.ts";
import type { RepoYetiConfig } from "../src/config.ts";
import type { FetchFn } from "../src/ai.ts";

function capture(): { events: Array<{ event: string; data: string }>; stop: () => void } {
  const events: Array<{ event: string; data: string }> = [];
  const listener = (event: string, data: string): void => void events.push({ event, data });
  addListener(listener);
  return { events, stop: () => removeListener(listener) };
}

/** Injected fetch that answers every request with a fixed status (JSON body) — no real network. */
const resp = (status: number, body = '{"data":[]}'): FetchFn =>
  async () => new Response(body, { status, headers: { "content-type": "application/json" } });
const throwingFetch: FetchFn = async () => {
  throw new Error("fetch must not be called in this test");
};

test("an owner key that is rejected (401) broadcasts ai_key_invalid and is tracked", async () => {
  const cfg = { roots: [], ai: { providers: { groq: { apiKey: "gsk_owner", model: "x" } } } } as unknown as RepoYetiConfig;
  const cap = capture();
  try {
    await checkAiKeys(cfg, resp(401));
    const invalid = cap.events.find((e) => e.event === "ai_key_invalid");
    expect(invalid).toBeDefined();
    expect(JSON.parse(invalid!.data).provider).toBe("groq");
    // Also tracked for the /api/status catch-up path.
    expect(invalidAiKeys().map((k) => k.provider)).toEqual(["groq"]);
  } finally {
    cap.stop();
  }
});

test("an owner key that validates (200) broadcasts nothing and clears the tracked list", async () => {
  const cfg = { roots: [], ai: { providers: { groq: { apiKey: "gsk_owner", model: "x" } } } } as unknown as RepoYetiConfig;
  const cap = capture();
  try {
    await checkAiKeys(cfg, resp(200));
    expect(cap.events.some((e) => e.event === "ai_key_invalid")).toBe(false);
    expect(invalidAiKeys()).toEqual([]);
  } finally {
    cap.stop();
  }
});

test("no configured keys → no probe, no broadcast (fetch never called)", async () => {
  // A provider row with a model but NO apiKey is skipped; AI is fully bring-your-own-key now.
  const cfg = { roots: [], ai: { providers: { openai: { model: "x" } } } } as unknown as RepoYetiConfig;
  const cap = capture();
  try {
    await checkAiKeys(cfg, throwingFetch);
    expect(cap.events.some((e) => e.event === "ai_key_invalid")).toBe(false);
    expect(invalidAiKeys()).toEqual([]);
  } finally {
    cap.stop();
  }
});
