import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { redactAi, resolveApiKey, type RepoYetiConfig } from "../src/config.ts";
import {
  parseModels,
  extractCompletion,
  cleanCommitMessage,
  listModels,
  generateCommitMessage,
  AiError,
  type FetchFn,
} from "../src/ai.ts";
import { collectCommitDiff } from "../src/git-actions.ts";

const BASE: RepoYetiConfig = { roots: [], port: 7171, maxDepth: 6, maxRepos: 200 };

// ── redaction: the key must NEVER leave the daemon ──────────────────────────────
test("redactAi never emits an apiKey and reports configured providers", () => {
  const cfg: RepoYetiConfig = {
    ...BASE,
    ai: {
      providers: {
        openai: { apiKey: "sk-SECRET-openai", model: "gpt-4o" },
        anthropic: { apiKey: "sk-ant-SECRET", model: null },
      },
      defaultProvider: "openai",
      style: "conventional",
    },
  };
  const r = redactAi(cfg);
  expect(JSON.stringify(r)).not.toContain("SECRET");
  expect(r.providers.openai).toEqual({ configured: true, model: "gpt-4o" });
  expect(r.providers.anthropic).toEqual({ configured: true, model: null });
  expect(r.providers.gemini).toBeUndefined();
  expect(r.defaultProvider).toBe("openai");
  expect(r.style).toBe("conventional");
});

test("AI is unconfigured until the owner supplies a key", () => {
  const fresh = redactAi(BASE);
  expect(fresh.defaultProvider).toBeNull();
  expect(fresh.providers.groq).toBeUndefined();
  expect(fresh.providers.openai).toBeUndefined();
  expect(resolveApiKey(BASE, "groq")).toBeNull();
  expect(resolveApiKey(BASE, "openai")).toBeNull();

  // The owner's own Groq key enables the provider without exposing the key.
  const own: RepoYetiConfig = {
    ...BASE,
    ai: { providers: { groq: { apiKey: "gsk-OWN-KEY", model: "llama-3.1-8b-instant" } } },
  };
  expect(resolveApiKey(own, "groq")).toBe("gsk-OWN-KEY");
  expect(redactAi(own).providers.groq).toEqual({
    configured: true,
    model: "llama-3.1-8b-instant",
  });
  expect(JSON.stringify(redactAi(own))).not.toContain("OWN-KEY");
});

test("redactAi clears the default provider when the chosen default is not configured", () => {
  const r = redactAi({ ...BASE, ai: { providers: {}, defaultProvider: "openai" } });
  expect(r.defaultProvider).toBeNull();
  expect(r.providers.groq).toBeUndefined();
  expect(r.style).toBe("conventional");
});

// ── model-list parsers (pure, fixture JSON) ─────────────────────────────────────
test("openai parser keeps chat models and drops non-chat ones", () => {
  const ids = parseModels("openai", {
    data: [
      { id: "gpt-4o" },
      { id: "gpt-3.5-turbo" },
      { id: "o1-mini" },
      { id: "text-embedding-3-small" },
      { id: "whisper-1" },
      { id: "dall-e-3" },
      { id: "tts-1" },
    ],
  }).map((m) => m.id);
  expect(ids).toContain("gpt-4o");
  expect(ids).toContain("gpt-3.5-turbo");
  expect(ids).toContain("o1-mini");
  expect(ids).not.toContain("text-embedding-3-small");
  expect(ids).not.toContain("whisper-1");
  expect(ids).not.toContain("dall-e-3");
  expect(ids).not.toContain("tts-1");
});

test("anthropic parser keeps id + display_name label", () => {
  const models = parseModels("anthropic", {
    data: [{ id: "claude-3-5-sonnet-20241022", display_name: "Claude 3.5 Sonnet" }],
  });
  expect(models).toEqual([{ id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }]);
});

test("gemini parser strips the models/ prefix and requires generateContent", () => {
  const models = parseModels("gemini", {
    models: [
      { name: "models/gemini-1.5-pro", supportedGenerationMethods: ["generateContent"] },
      { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
    ],
  });
  expect(models).toEqual([{ id: "gemini-1.5-pro", label: "gemini-1.5-pro" }]);
});

test("deepseek parser keeps all chat ids", () => {
  const ids = parseModels("deepseek", {
    data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }],
  }).map((m) => m.id);
  expect(ids.sort()).toEqual(["deepseek-chat", "deepseek-reasoner"]);
});

// ── completion extraction + cleanup ─────────────────────────────────────────────
test("extractCompletion reads each provider's response shape", () => {
  expect(extractCompletion("anthropic", { content: [{ type: "text", text: "hi" }] })).toBe("hi");
  expect(extractCompletion("openai", { choices: [{ message: { content: "hi" } }] })).toBe("hi");
  expect(extractCompletion("deepseek", { choices: [{ message: { content: "hi" } }] })).toBe("hi");
  expect(extractCompletion("gemini", { candidates: [{ content: { parts: [{ text: "hi" }] } }] })).toBe("hi");
});

test("cleanCommitMessage strips code fences and wrapping quotes", () => {
  expect(cleanCommitMessage("```\nfix: thing\n```")).toBe("fix: thing");
  expect(cleanCommitMessage('"add a feature"')).toBe("add a feature");
  expect(cleanCommitMessage("  plain message  ")).toBe("plain message");
});

// Git's subject is everything up to the first blank line, so a body running straight on after
// line 1 makes the WHOLE message the subject. Observed live: llama-3.3-70b did exactly this
// despite the prompt asking for the blank line.
test("cleanCommitMessage forces git's blank line between subject and body", () => {
  expect(cleanCommitMessage("feat: add thing\n- one\n- two")).toBe("feat: add thing\n\n- one\n- two");
  // already correct → unchanged (no double-spacing)
  expect(cleanCommitMessage("feat: add thing\n\n- one")).toBe("feat: add thing\n\n- one");
  // subject-only stays a single line
  expect(cleanCommitMessage("feat: add thing")).toBe("feat: add thing");
  // a trailing space on the subject (also observed live) is trimmed
  expect(cleanCommitMessage("feat: add thing   \nbody")).toBe("feat: add thing\n\nbody");
  // blank-line-only tail collapses to a plain subject rather than trailing newlines
  expect(cleanCommitMessage("feat: add thing\n\n   ")).toBe("feat: add thing");
});

// ── network paths behind an injected fetch (no real provider hit) ────────────────
function fakeFetch(status: number, body: unknown, capture?: (url: string, init?: RequestInit) => void): FetchFn {
  return async (url, init) => {
    capture?.(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}

test("listModels parses a 200 body and maps 401 to AI_AUTH_FAILED", async () => {
  const ok = await listModels("openai", "sk-x", fakeFetch(200, { data: [{ id: "gpt-4o" }] }));
  expect(ok.map((m) => m.id)).toEqual(["gpt-4o"]);

  await expect(listModels("openai", "bad", fakeFetch(401, { error: { message: "bad key" } }))).rejects.toMatchObject({
    code: "AI_AUTH_FAILED",
  });
});

test("generateCommitMessage sends the model + returns a cleaned message", async () => {
  let sentUrl = "";
  let sentBody: { model?: string; messages?: Array<{ role?: string; content?: unknown }> } | null = null;
  const f = fakeFetch(200, { choices: [{ message: { content: "```\nfeat: add x\n```" } }] }, (url, init) => {
    sentUrl = url;
    sentBody = init?.body ? JSON.parse(String(init.body)) : null;
  });
  const msg = await generateCommitMessage("openai", "sk-x", "gpt-4o", "DIFF", "conventional", f);
  expect(msg).toBe("feat: add x");
  expect(sentUrl).toContain("/chat/completions");
  expect(sentBody!.model).toBe("gpt-4o");
  expect(sentBody!.messages?.some((m) => m.role === "user" && String(m.content).includes("DIFF"))).toBe(true);
});

test("generateCommitMessage throws on an empty model reply", async () => {
  await expect(
    generateCommitMessage("openai", "sk-x", "gpt-4o", "DIFF", "concise", fakeFetch(200, { choices: [{ message: { content: "" } }] })),
  ).rejects.toBeInstanceOf(AiError);
});

// ── diff collection (read-only; capped) ─────────────────────────────────────────
async function seededRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "gm-ai-"));
  await $`git -c init.defaultBranch=main init -q ${dir}`.quiet();
  writeFileSync(join(dir, "base.txt"), "original\n");
  await $`git -C ${dir} add -A`.quiet();
  await $`git -C ${dir} -c user.name=Seed -c user.email=s@s.io commit -q -m init`.quiet();
  return dir;
}

test("collectCommitDiff captures status + diff and never mutates the index", async () => {
  const dir = await seededRepo();
  writeFileSync(join(dir, "base.txt"), "changed\n");
  writeFileSync(join(dir, "new.txt"), "added\n");
  const out = await collectCommitDiff(dir);
  expect(out).toContain("# git status");
  expect(out).toContain("new.txt"); // untracked file shows up in the porcelain list
  expect(out).toContain("# git diff");
  expect(out).toContain("changed"); // the tracked modification is in the diff

  // read-only: nothing was staged
  const staged = (await $`git -C ${dir} diff --cached --name-only`.text()).trim();
  expect(staged).toBe("");
});

test("collectCommitDiff FOLDS one huge file rather than spending the whole payload on it", async () => {
  const dir = await seededRepo();
  writeFileSync(join(dir, "base.txt"), "x\n".repeat(40_000)); // ~80 KB modification
  const out = await collectCommitDiff(dir);
  expect(out.length).toBeLessThan(25_000); // bounded, as it always was...
  // ...but now bounded by FOLDING rather than by lopping the tail off the payload. This used to
  // ship ~24k of one file's diff and end in "…[truncated]"; a runaway file now costs only its
  // per-file slice, which is the whole point (that file was 97% of a real repo's diff).
  expect(out.length).toBeLessThan(8_000);
  expect(out).toContain("diff lines folded"); // and it says what it dropped, in-band
  expect(out).toContain("base.txt"); // the file is still named + visible to the model
});

test("collectCommitDiff still truncates when even the FOLDED diff overruns the cap", async () => {
  const dir = await seededRepo();
  // 40 tracked files, each modified well past its fold slice: every file costs ~2k folded, so the
  // SUM still overruns DIFF_CAP — the payload-level truncation marker must survive folding.
  for (let i = 0; i < 40; i++) writeFileSync(join(dir, `f${i}.txt`), "seed\n");
  await $`git -C ${dir} add -A`.quiet();
  await $`git -C ${dir} -c user.name=Seed -c user.email=s@s.io commit -q -m more`.quiet();
  for (let i = 0; i < 40; i++) writeFileSync(join(dir, `f${i}.txt`), "y\n".repeat(3_000));
  const out = await collectCommitDiff(dir);
  expect(out.length).toBeLessThan(25_000);
  expect(out.endsWith("…[truncated]")).toBe(true);
});

test("the diff-detail dial changes what the message path sends", async () => {
  const dir = await seededRepo();
  writeFileSync(join(dir, "base.txt"), "x\n".repeat(40_000));
  const lean = await collectCommitDiff(dir, "lean");
  const thorough = await collectCommitDiff(dir, "thorough");
  expect(lean.length).toBeLessThan(thorough.length); // ✨ Generate honors the dial, not just Auto
});
