/**
 * Editing and re-keying a share link.
 *
 * Both of these change a grant that someone else may already be holding, so the rules that matter
 * are the ones about what MUST NOT happen: an edit must never touch the secret (or every link the
 * owner already sent dies for no reason), a rotate must invalidate the old secret (or "give me a
 * working link again" would silently leave two live keys), and neither may resurrect a revoked
 * share — reviving a secret the owner deliberately killed is the one outcome a PATCH should never
 * be able to produce.
 */
import { test, expect, beforeAll } from "bun:test";
import {
  initDb,
  createShare,
  updateShare,
  rotateShareToken,
  revokeShare,
  getShare,
  getShareByTokenHash,
  shareRepoIds,
  type Share,
} from "../src/db.ts";
import { hashToken, mintToken } from "../src/share/index.ts";
import { mkScratchDir } from "./helpers/scratch.ts";
import { mustUpsertRepo } from "./helpers/upsert.ts";
import { $ } from "bun";

let repoA = "";
let repoB = "";

async function gitRepo(name: string): Promise<string> {
  const dir = mkScratchDir(name);
  await $`git init -q ${dir}`.quiet();
  return mustUpsertRepo(dir, name, "pinned", false);
}

beforeAll(async () => {
  initDb();
  repoA = await gitRepo("share-edit-a");
  repoB = await gitRepo("share-edit-b");
});

function mint(overrides: Partial<Parameters<typeof createShare>[1]> = {}): { share: Share; token: string } {
  const token = mintToken();
  const share = createShare(hashToken(token), {
    label: "for my brother",
    perm: "view",
    scopeAll: false,
    repoIds: [repoA],
    expiresAt: null,
    ...overrides,
  });
  return { share, token };
}

test("an edit changes the grant and leaves the secret alone", () => {
  const { share, token } = mint();

  const updated = updateShare(share.id, { label: "renamed", perm: "control" });
  expect(updated?.label).toBe("renamed");
  expect(updated?.perm).toBe("control");

  // The whole point: a link already sent still resolves to this share.
  expect(getShareByTokenHash(hashToken(token))?.id).toBe(share.id);
});

test("editing the repo scope replaces the list rather than appending to it", () => {
  const { share } = mint();
  expect(shareRepoIds(share.id)).toEqual([repoA]);

  updateShare(share.id, { scopeAll: false, repoIds: [repoB] });
  // Not [repoA, repoB] — the grant is exactly what was last set, so narrowing a link actually
  // narrows it instead of quietly widening it.
  expect(shareRepoIds(share.id)).toEqual([repoB]);
});

test("switching a share to scopeAll clears its per-repo rows", () => {
  const { share } = mint();
  updateShare(share.id, { scopeAll: true });
  expect(getShare(share.id)?.scopeAll).toBe(true);
  // Stale rows behind a scopeAll grant would come back if it were ever narrowed again.
  expect(shareRepoIds(share.id)).toEqual([]);
});

test("an omitted field is left as it was", () => {
  const { share } = mint({ label: "keep me", perm: "control" });
  updateShare(share.id, { label: "new label" });
  const after = getShare(share.id);
  expect(after?.label).toBe("new label");
  expect(after?.perm).toBe("control"); // untouched
  expect(after?.expiresAt).toBeNull();
});

test("expiry can be set and cleared explicitly", () => {
  const { share } = mint();
  const when = Date.now() + 86_400_000;
  expect(updateShare(share.id, { expiresAt: when })?.expiresAt).toBe(when);
  expect(updateShare(share.id, { expiresAt: null })?.expiresAt).toBeNull();
});

test("rotating mints a new secret and kills the old one", () => {
  const { share, token } = mint();
  const next = mintToken();
  expect(next).not.toBe(token);

  const rotated = rotateShareToken(share.id, hashToken(next));
  expect(rotated?.id).toBe(share.id);

  // The new link works…
  expect(getShareByTokenHash(hashToken(next))?.id).toBe(share.id);
  // …and the one the owner lost is now worthless, which is the trade being made.
  expect(getShareByTokenHash(hashToken(token))).toBeNull();
});

test("rotating resets the usage counters, since they described the old key", () => {
  const { share } = mint();
  const rotated = rotateShareToken(share.id, hashToken(mintToken()));
  expect(rotated?.useCount).toBe(0);
  expect(rotated?.lastUsedAt).toBeNull();
});

test("a revoked share can be neither edited nor rotated", () => {
  const { share, token } = mint();
  expect(revokeShare(share.id)).toBe(true);

  expect(updateShare(share.id, { label: "back from the dead" })).toBeNull();
  expect(rotateShareToken(share.id, hashToken(mintToken()))).toBeNull();

  // And the original secret stays dead rather than being quietly re-armed.
  const found = getShareByTokenHash(hashToken(token));
  expect(found?.revokedAt).not.toBeNull();
});

test("editing an unknown id reports failure instead of creating one", () => {
  expect(updateShare("00000000-0000-0000-0000-000000000000", { label: "nope" })).toBeNull();
  expect(rotateShareToken("00000000-0000-0000-0000-000000000000", hashToken(mintToken()))).toBeNull();
});
