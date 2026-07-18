import { test, expect, beforeEach } from "bun:test";
import {
  setAutoDenyEnabled,
  setAutoApproveEnabled,
  autoDenyIsEnabled,
  autoApproveIsEnabled,
} from "../src/approvals.ts";

// Auto-deny and auto-approve must never both be armed. With both on, a pending MCP approval has
// two timers racing to OPPOSITE verdicts and the winner is whichever timeout happens to be
// shorter — that isn't a policy, it's a coin flip on a security gate. The daemon enforces the
// exclusion when either is toggled (src/http/routes/health.ts) and normalises a stale config at
// boot (src/http/app.ts). These tests pin the shape of both rules.

/** Mirrors the PUT /api/settings rule: turning one on turns the other off, unconditionally. */
function applyToggle(which: "deny" | "approve", value: boolean): void {
  if (which === "deny") {
    setAutoDenyEnabled(value);
    if (value) setAutoApproveEnabled(false);
  } else {
    setAutoApproveEnabled(value);
    if (value) setAutoDenyEnabled(false);
  }
}

/** Mirrors the boot rule: deny wins when a stale config carries both. */
function normaliseAtBoot(cfgDeny: boolean | undefined, cfgApprove: boolean | undefined): void {
  const deny = cfgDeny !== false;
  const approve = !deny && cfgApprove === true;
  setAutoDenyEnabled(deny);
  setAutoApproveEnabled(approve);
}

const bothArmed = (): boolean => autoDenyIsEnabled() && autoApproveIsEnabled();

beforeEach(() => {
  setAutoDenyEnabled(true);
  setAutoApproveEnabled(false);
});

test("arming auto-approve disarms auto-deny", () => {
  expect(autoDenyIsEnabled()).toBe(true);
  applyToggle("approve", true);
  expect(autoApproveIsEnabled()).toBe(true);
  expect(autoDenyIsEnabled()).toBe(false);
  expect(bothArmed()).toBe(false);
});

test("arming auto-deny disarms auto-approve", () => {
  applyToggle("approve", true);
  expect(autoApproveIsEnabled()).toBe(true);

  applyToggle("deny", true);
  expect(autoDenyIsEnabled()).toBe(true);
  expect(autoApproveIsEnabled()).toBe(false);
  expect(bothArmed()).toBe(false);
});

test("turning one OFF does not arm the other", () => {
  // Disarming is not a request to arm the opposite: "no auto-deny" must not mean "auto-approve".
  applyToggle("deny", false);
  expect(autoDenyIsEnabled()).toBe(false);
  expect(autoApproveIsEnabled()).toBe(false);

  applyToggle("approve", false);
  expect(autoApproveIsEnabled()).toBe(false);
  expect(autoDenyIsEnabled()).toBe(false);
});

test("no sequence of toggles can leave both armed", () => {
  const moves: Array<["deny" | "approve", boolean]> = [
    ["deny", true], ["approve", true], ["approve", true], ["deny", true],
    ["deny", false], ["approve", true], ["deny", true], ["approve", false],
    ["approve", true], ["approve", false], ["deny", true], ["deny", true],
  ];
  for (const [which, value] of moves) {
    applyToggle(which, value);
    expect(bothArmed()).toBe(false);
  }
});

test("a stale config carrying both normalises to deny, never to approve", () => {
  normaliseAtBoot(true, true);
  expect(autoDenyIsEnabled()).toBe(true);
  expect(autoApproveIsEnabled()).toBe(false); // the safe side: never silently auto-approve
});

test("boot defaults: absent means auto-deny on, auto-approve off", () => {
  normaliseAtBoot(undefined, undefined);
  expect(autoDenyIsEnabled()).toBe(true);
  expect(autoApproveIsEnabled()).toBe(false);
});

test("boot honours an explicit auto-approve only when auto-deny is explicitly off", () => {
  normaliseAtBoot(false, true);
  expect(autoDenyIsEnabled()).toBe(false);
  expect(autoApproveIsEnabled()).toBe(true);
  expect(bothArmed()).toBe(false);
});
