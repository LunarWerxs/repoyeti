import { test, expect, afterEach } from "bun:test";
import {
  runAutoUpdateOnce,
  setAutoUpdateHooks,
  setAutoUpdateEnabled,
  setUpdateNotifyEnabled,
  stopAutoUpdate,
  clampAutoUpdateInterval,
  AUTO_UPDATE_INTERVAL_MIN_S,
  AUTO_UPDATE_INTERVAL_MAX_S,
  AUTO_UPDATE_INTERVAL_DEFAULT_S,
} from "../src/auto-update.ts";

// The auto-update orchestrator's decision logic, driven through injected hooks so nothing actually
// pulls git / spawns / exits.
//
// Two settings share this pass and they are NOT the same consent:
//   · updateNotify (on by default) — announce an available update; install nothing.
//   · autoUpdate   (opt-in)        — additionally apply it and relaunch, unattended.
// So the apply-path cases below explicitly enable autoUpdate: without it, "nothing was applied"
// would pass for the wrong reason (the setting was off) rather than the reason under test.

// Reset the module's hooks + timer state after each case so they don't bleed across tests.
afterEach(() => {
  setAutoUpdateEnabled(false);
  setUpdateNotifyEnabled(true); // module default
  stopAutoUpdate();
  setAutoUpdateHooks({}); // restore the real hooks
});

// A full UpdateStatus with sensible defaults; overrides tweak the fields under test.
// biome-ignore lint/suspicious/noExplicitAny: loose fixture shape so overrides can merge freely
function status(over: Record<string, unknown>): any {
  return {
    ok: true,
    service: "repoyeti",
    currentVersion: "0.1.0",
    currentCommit: "aaaa",
    remoteCommit: "bbbb",
    branch: "main",
    upstream: "origin/main",
    remote: "origin",
    dirty: false,
    updateAvailable: false,
    canApply: false,
    checkedAt: 0,
    reason: null,
    ...over,
  };
}
// biome-ignore lint/suspicious/noExplicitAny: loose fixture shape so overrides can merge freely
function applyResult(over: Record<string, unknown>): any {
  return { ok: true, message: "updated", restartRequired: true, status: status({}), output: [], ...over };
}

test("applies + relaunches when an update is available and applicable", async () => {
  let applied = 0;
  let relaunched = 0;
  setAutoUpdateEnabled(true); // testing the apply path
  setAutoUpdateHooks({
    check: async () => status({ updateAvailable: true, canApply: true }),
    apply: async () => {
      applied++;
      return applyResult({ restartRequired: true });
    },
    relaunch: () => {
      relaunched++;
    },
  });
  const r = await runAutoUpdateOnce();
  expect(r.applied).toBe(true);
  expect(r.relaunched).toBe(true);
  expect(applied).toBe(1);
  expect(relaunched).toBe(1);
});

test("does nothing when already up to date", async () => {
  let applied = 0;
  setAutoUpdateHooks({
    check: async () => status({ updateAvailable: false }),
    apply: async () => {
      applied++;
      return applyResult({});
    },
    relaunch: () => {},
  });
  const r = await runAutoUpdateOnce();
  expect(r.applied).toBe(false);
  expect(r.reason).toBe("up-to-date");
  expect(applied).toBe(0);
});

test("never applies on a dirty tree (canApply false)", async () => {
  let applied = 0;
  let relaunched = 0;
  setAutoUpdateEnabled(true); // testing the apply path
  setAutoUpdateHooks({
    check: async () =>
      status({ updateAvailable: true, canApply: false, dirty: true, reason: "local changes must be committed or stashed before updating" }),
    apply: async () => {
      applied++;
      return applyResult({});
    },
    relaunch: () => {
      relaunched++;
    },
  });
  const r = await runAutoUpdateOnce();
  expect(r.applied).toBe(false);
  expect(applied).toBe(0);
  expect(relaunched).toBe(0);
});

test("does not relaunch when the apply fails", async () => {
  let relaunched = 0;
  setAutoUpdateEnabled(true); // testing the apply path
  setAutoUpdateHooks({
    check: async () => status({ updateAvailable: true, canApply: true }),
    apply: async () => applyResult({ ok: false, message: "build failed" }),
    relaunch: () => {
      relaunched++;
    },
  });
  const r = await runAutoUpdateOnce();
  expect(r.applied).toBe(false);
  expect(r.relaunched).toBe(false);
  expect(relaunched).toBe(0);
});

test("reports the reason when the check itself fails", async () => {
  setAutoUpdateHooks({
    check: async () => status({ ok: false, reason: "no update remote configured" }),
    apply: async () => applyResult({}),
    relaunch: () => {},
  });
  const r = await runAutoUpdateOnce();
  expect(r.applied).toBe(false);
  expect(r.reason).toBe("no update remote configured");
});

test("clampAutoUpdateInterval bounds the cadence", () => {
  expect(clampAutoUpdateInterval(10)).toBe(AUTO_UPDATE_INTERVAL_MIN_S);
  expect(clampAutoUpdateInterval(9_999_999)).toBe(AUTO_UPDATE_INTERVAL_MAX_S);
  expect(clampAutoUpdateInterval(Number.NaN)).toBe(AUTO_UPDATE_INTERVAL_DEFAULT_S);
  expect(clampAutoUpdateInterval(3600)).toBe(3600);
});

// ── notify half: an update is announced, never installed ──────────────────────────────────

test("with auto-apply OFF it announces instead of installing", async () => {
  let applied = 0;
  let relaunched = 0;
  setUpdateNotifyEnabled(true);
  setAutoUpdateHooks({
    check: async () => status({ updateAvailable: true, canApply: true }),
    apply: async () => {
      applied++;
      return applyResult({});
    },
    relaunch: () => {
      relaunched++;
    },
  });
  const r = await runAutoUpdateOnce();
  expect(r.reason).toBe("notified");
  expect(r.applied).toBe(false);
  expect(r.relaunched).toBe(false);
  // The whole point: being told costs nothing and touches nothing.
  expect(applied).toBe(0);
  expect(relaunched).toBe(0);
});

test("announces even when the update cannot be applied (dirty tree)", async () => {
  // "An update is waiting, commit your work to take it" is exactly the useful thing to know.
  setUpdateNotifyEnabled(true);
  setAutoUpdateHooks({
    check: async () => status({ updateAvailable: true, canApply: false, dirty: true, reason: "local changes" }),
    apply: async () => applyResult({}),
    relaunch: () => {},
  });
  const r = await runAutoUpdateOnce();
  expect(r.applied).toBe(false);
  expect(r.reason).toBe("notified");
});

test("with both halves off it does nothing at all", async () => {
  let applied = 0;
  setAutoUpdateEnabled(false);
  setUpdateNotifyEnabled(false);
  setAutoUpdateHooks({
    check: async () => status({ updateAvailable: true, canApply: true }),
    apply: async () => {
      applied++;
      return applyResult({});
    },
    relaunch: () => {},
  });
  const r = await runAutoUpdateOnce();
  expect(r.reason).toBe("notify-off");
  expect(r.applied).toBe(false);
  expect(applied).toBe(0);
});

test("nothing is announced or applied when already up to date", async () => {
  setUpdateNotifyEnabled(true);
  setAutoUpdateHooks({
    check: async () => status({ updateAvailable: false }),
    apply: async () => applyResult({}),
    relaunch: () => {},
  });
  const r = await runAutoUpdateOnce();
  expect(r.reason).toBe("up-to-date");
});
