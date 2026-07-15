/**
 * Single-message commit drafting: prompt building, HTTP plumbing, and the two simplest
 * public entry points — model discovery (`listModels`) and one-shot message generation
 * (`generateCommitMessage`). Network is reached via the global `fetch`, injectable
 * (`fetchImpl`) so parsing + request shaping are testable without hitting a provider.
 * Failures map to a small set of stable codes the UI can render (mirrors the classify()
 * pattern in git-actions.ts).
 */
import type { AiProviderId, CommitStyle } from "../config.ts";
import { AI_ADAPTERS, parseModels, type AiModel } from "./adapters.ts";

export type AiCode =
  | "OK"
  | "AI_AUTH_FAILED"
  | "AI_UNREACHABLE"
  | "AI_BAD_REQUEST"
  | "AI_RATE_LIMITED"
  | "AI_ERROR";

export class AiError extends Error {
  code: AiCode;
  status: number;
  constructor(code: AiCode, message: string, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Injectable fetch (defaults to the global). */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 20_000;

// ── rate-limit gate (anti-hammer) ────────────────────────────────────────────────
//
// A provider that just answered 429 will answer 429 again. Re-asking costs a round-trip, burns
// request quota, and makes the owner wait to be told the same thing — so once a generation call
// is rate-limited we remember it and answer from memory for a bit.
//
// The wait is deliberately NOT the provider's own `retry-after`: Groq hands back values like
// 13010s (3.6h), and hard-blocking for hours would be wrong the moment the owner upgrades their
// tier, swaps the key, or the rolling window frees up (Groq's daily budget decays continuously —
// observed dropping while idle). So we cap the local pause at a minute: enough that clicking
// "Auto" or flipping styles can't machine-gun the API, short enough to self-heal. The provider's
// real message (which does say "try again in 3h36m") is kept and re-surfaced verbatim.
const GATE_MAX_MS = 60_000;
/** provider id → when we may probe again, plus the message to answer with until then. */
const rateGate = new Map<string, { until: number; message: string }>();

/** Seconds from a `Retry-After` header (delta-seconds or HTTP-date), or null. */
function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const secs = Number(h.trim());
  if (Number.isFinite(secs) && secs >= 0) return secs;
  const when = Date.parse(h);
  return Number.isFinite(when) ? Math.max(0, (when - Date.now()) / 1000) : null;
}

/** Clear a provider's pause — call when its key/model changes, so a fix takes effect at once. */
export function clearRateGate(provider?: string): void {
  if (provider) rateGate.delete(provider);
  else rateGate.clear();
}

/** For tests/diagnostics: ms until `provider` may be probed again (0 = not gated). */
export function rateGateRemainingMs(provider: string): number {
  const g = rateGate.get(provider);
  return g ? Math.max(0, g.until - Date.now()) : 0;
}

// ── prompt building (PURE) ───────────────────────────────────────────────────────

const BASE_SYSTEM =
  "You write a git commit message from a diff. Output ONLY the commit message text — " +
  "no markdown code fences, no surrounding quotes, no preamble like 'Here is', no explanation.";

export function systemPromptFor(style: CommitStyle): string {
  switch (style) {
    // The default, and the one tuned to read like a hand-written repo commit (the shape VS Code /
    // Copilot emit): Conventional-Commits subject, blank line, then a body that says WHY. The old
    // wording ended at "add a blank line then a short body", which models happily read as
    // "subject only" — hence messages that felt too terse to be useful.
    case "conventional":
      return (
        BASE_SYSTEM +
        " Follow the Conventional Commits format.\n" +
        "SUBJECT (first line): `type(scope): description`, at most 72 characters, imperative mood " +
        '("add", never "added"/"adds"), no trailing period, description in lower case. `type` is ' +
        "one of feat, fix, docs, style, refactor, perf, test, build, ci, chore. `scope` is an " +
        "optional lowercase subsystem — omit it rather than invent a vague one.\n" +
        "BODY: unless the change is a trivial one-liner, add a blank line after the subject, then " +
        'explain WHAT changed and WHY. Use "- " bullets when there is more than one notable ' +
        "point, one point per bullet, wrapped at about 72 characters. Describe intent and effect, " +
        "not a file-by-file restatement of the diff. Never repeat the subject line, and never " +
        "pad with filler — if there is genuinely only one thing to say, say only that."
      );
    case "detailed":
      return (
        BASE_SYSTEM +
        " Write an imperative subject line of at most 72 characters, then a blank line, then a " +
        "concise body (a few sentences or bullet points) explaining what changed and why."
      );
    default:
      return (
        BASE_SYSTEM +
        " Write a single concise imperative subject line of at most 72 characters that summarizes " +
        "the change. Do not add a body."
      );
  }
}

const userPromptFor = (diff: string): string =>
  `Write a commit message for the following staged/working changes.\n\n${diff}`;

/** Strip stray code fences / wrapping quotes a model sometimes adds despite instructions, and
 *  enforce git's subject/body separator. */
export function cleanCommitMessage(text: string): string {
  let s = text.trim();
  // Remove a leading/trailing ``` fence (optionally ```text).
  s = s.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```$/, "").trim();
  // Remove symmetric wrapping quotes.
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  // Git defines the SUBJECT as everything up to the first blank line. A model that runs its body
  // straight on after line 1 — observed live, despite the prompt asking for the blank line — turns
  // the entire message into one enormous subject in `git log --oneline`, shortlogs and every UI
  // that shows "the first line". The prompt can ask; only this can guarantee. Structural, so it's
  // fixed here rather than left to the model's goodwill.
  const nl = s.indexOf("\n");
  if (nl !== -1) {
    const subject = s.slice(0, nl).trimEnd();
    const rest = s.slice(nl + 1);
    if (rest.trim()) s = `${subject}\n\n${rest.replace(/^\s*\n/, "")}`;
    else s = subject;
  }
  return s;
}

// ── HTTP plumbing ─────────────────────────────────────────────────────────────

function extractErrMessage(json: unknown, fallback: string): string {
  const j = json as { error?: { message?: unknown } | string; message?: unknown } | null;
  const err = j?.error;
  const msg = (err && typeof err === "object" ? err.message : undefined) ?? j?.message ?? err ?? fallback;
  return String(typeof msg === "string" ? msg : fallback)
    .split("\n")[0]!
    .slice(0, 280);
}

/**
 * One JSON request with a timeout; maps non-2xx + network/timeout to AiError.
 *
 * `gate` opts this call into the rate-limit pause above. Only GENERATION calls pass it — model
 * listing deliberately does not, so a rate-limited plan can never stop the owner from connecting
 * or re-picking a key in Settings (the one screen where they'd go to fix it).
 */
export async function requestJson(
  url: string,
  init: RequestInit,
  fetchImpl: FetchFn,
  timeoutMs = REQUEST_TIMEOUT_MS,
  gate?: string,
): Promise<unknown> {
  if (gate) {
    const g = rateGate.get(gate);
    if (g && Date.now() < g.until) throw new AiError("AI_RATE_LIMITED", g.message, 429);
  }
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new AiError("AI_UNREACHABLE", "could not reach the AI provider (timeout or network error)");
  }
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* leave json as {}; text used for the error message */
  }
  if (!res.ok) {
    const message = extractErrMessage(json, text || res.statusText);
    if (res.status === 401 || res.status === 403) {
      throw new AiError("AI_AUTH_FAILED", "invalid or unauthorized API key", res.status);
    }
    if (res.status === 400 || res.status === 404 || res.status === 422) {
      throw new AiError("AI_BAD_REQUEST", message, res.status);
    }
    // 429 is its own thing, and the provider's own text is the useful part — it names the limit
    // that tripped and when it resets ("… tokens per day (TPD): Limit 100000 … try again in
    // 4h55m"). Callers surface `message` verbatim rather than guessing at the cause: a free-tier
    // daily cap is a wildly different fix (wait / upgrade / switch provider) from "the AI failed".
    if (res.status === 429) {
      if (gate) {
        const retryS = parseRetryAfter(res.headers.get("retry-after"));
        const pause = Math.min(retryS != null ? retryS * 1000 : GATE_MAX_MS, GATE_MAX_MS);
        rateGate.set(gate, { until: Date.now() + pause, message });
      }
      throw new AiError("AI_RATE_LIMITED", message, res.status);
    }
    throw new AiError("AI_ERROR", message, res.status);
  }
  if (gate) rateGate.delete(gate); // recovered → stop answering from memory
  return json;
}

// ── public API ────────────────────────────────────────────────────────────────

/** Validate the key AND discover the models it unlocks. */
export async function listModels(
  provider: AiProviderId,
  apiKey: string,
  fetchImpl: FetchFn = fetch,
): Promise<AiModel[]> {
  const adapter = AI_ADAPTERS[provider];
  const json = await requestJson(
    adapter.modelsUrl(apiKey),
    { method: "GET", headers: adapter.headers(apiKey) },
    fetchImpl,
  );
  return parseModels(provider, json);
}

/** Draft a commit message from a diff using the chosen provider + model. */
export async function generateCommitMessage(
  provider: AiProviderId,
  apiKey: string,
  model: string,
  diff: string,
  style: CommitStyle,
  fetchImpl: FetchFn = fetch,
): Promise<string> {
  const adapter = AI_ADAPTERS[provider];
  const system = systemPromptFor(style);
  const user = userPromptFor(diff);
  const json = await requestJson(
    adapter.generateUrl(model, apiKey),
    {
      method: "POST",
      headers: adapter.headers(apiKey),
      body: JSON.stringify(adapter.buildBody(model, system, user)),
    },
    fetchImpl,
    REQUEST_TIMEOUT_MS,
    provider, // share the rate-limit pause with the plan call — same provider, same budget
  );
  const text = adapter.extractCompletion(json);
  const cleaned = cleanCommitMessage(text ?? "");
  if (!cleaned) throw new AiError("AI_ERROR", "the model returned an empty message");
  return cleaned;
}
