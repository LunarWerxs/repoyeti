/**
 * zod request-body schemas + a tiny parse helper.
 *
 * The routes used to coerce `unknown` JSON by hand (`String(b.x ?? "").trim()`, ad-hoc
 * allowlists) — inconsistent and untyped. Each structured route now declares its body shape
 * here; `parseBody` validates once and hands back typed data, and a shape failure becomes the
 * standard `BAD_REQUEST` envelope (see contract.ts) with the offending field named.
 *
 * Domain rules that have their OWN error code (NO_KEY, NO_MESSAGE, NOT_CONFIGURED, …) stay in
 * the handler AFTER the shape check — so those codes are unchanged. That's why fields like
 * `apiKey`/`message` are `.optional()` here (shape allows absent → the handler still returns
 * its specific code), rather than `.min(1)` (which would collapse them to BAD_REQUEST).
 */
import type { Context } from "hono";
import { z } from "zod";
import { jsonError } from "./contract.ts";

/** Read + validate a JSON body. On failure returns a ready-to-return BAD_REQUEST response. */
export async function parseBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const raw = await c.req.json().catch(() => ({}));
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const issue = r.error.issues[0];
  const where = issue?.path.length ? issue.path.join(".") : "body";
  return { ok: false, res: jsonError(c, "BAD_REQUEST", `${where}: ${issue?.message ?? "invalid"}`) };
}

const nonEmpty = z.string().trim().min(1);

// ── identities ──────────────────────────────────────────────────────────────────
export const IdentityCreateSchema = z.object({
  displayName: nonEmpty,
  gitUsername: nonEmpty,
  gitEmail: nonEmpty,
  sshKeyPath: z.string().trim().nullish(), // optional; empty/absent → null in the handler
});

export const IdentityUpdateSchema = z.object({
  displayName: nonEmpty.optional(),
  gitUsername: nonEmpty.optional(),
  gitEmail: nonEmpty.optional(),
  // undefined = leave unchanged; null or "" = clear the key path.
  sshKeyPath: z.string().trim().nullish(),
});

export const AssignIdentitySchema = z.object({ identityId: z.string().trim().nullish() });

// ── repos ───────────────────────────────────────────────────────────────────────
export const RepoPathSchema = z.object({ path: nonEmpty });

export const ReorderSchema = z.object({ order: z.array(z.string()).max(10_000) });

export const CommitSchema = z.object({
  message: z.string().optional(), // NO_MESSAGE stays a domain check in the handler
  amend: z.boolean().optional(),
});

// ── AI ──────────────────────────────────────────────────────────────────────────
export const ConnectSchema = z.object({ apiKey: z.string().optional() }); // NO_KEY stays in handler

export const AiSettingsSchema = z.object({
  style: z.enum(["conventional", "concise", "detailed"]).optional(),
  defaultProvider: z.string().nullish(), // provider validity → NOT_CONFIGURED in the handler
});

export const ProviderUpdateSchema = z.object({
  model: z.string().nullish(),
  makeDefault: z.boolean().optional(),
});

export const CommitMessageSchema = z.object({ provider: z.string().optional() });
