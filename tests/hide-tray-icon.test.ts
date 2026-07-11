import { test, expect } from "bun:test";
import { createApp } from "../src/http/app.ts";
import type { RepoYetiConfig } from "../src/config.ts";
import { clearInstanceInfo, readInstanceInfo, writeInstanceInfo } from "../src/instance.ts";

// Settings persistence + the runtime-pointer sync for "Hide tray icon" — same shape as
// portable-window.test.ts's coverage of portableMode. The tray's live re-read of the flag off
// runtime.json (misc/RepoYeti-Tray.ps1's $watchTimer tick) is proven in tests/launcher.test.ts
// via source assertions, since there's no PowerShell NotifyIcon seam to exercise here.

const localCfg = (): RepoYetiConfig => ({ roots: [], port: 7171, maxDepth: 6, maxRepos: 200 });

test("GET /api/status defaults hideTrayIcon to false; PUT /api/settings flips it and echoes it back", async () => {
  const app = createApp(localCfg());

  const before = await (await app.request("/api/status")).json();
  expect(before.hideTrayIcon).toBe(false);

  const put = await app.request("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hideTrayIcon: true }),
  });
  expect(put.status).toBe(200);
  expect((await put.json()).hideTrayIcon).toBe(true);

  const after = await (await app.request("/api/status")).json();
  expect(after.hideTrayIcon).toBe(true);
});

test("PUT /api/settings with hideTrayIcon updates the existing runtime pointer (read-merge-write)", async () => {
  clearInstanceInfo();
  writeInstanceInfo(7171); // simulate a daemon already having bound + written its pointer
  expect(readInstanceInfo()?.hideTrayIcon).toBeUndefined();

  const app = createApp(localCfg());
  const put = await app.request("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hideTrayIcon: true }),
  });
  expect(put.status).toBe(200);

  expect(readInstanceInfo()?.hideTrayIcon).toBe(true);
  // Core fields (port/url/pid) survive the merge untouched.
  expect(readInstanceInfo()?.port).toBe(7171);

  clearInstanceInfo();
});

test("PUT /api/settings with hideTrayIcon is a no-op on the pointer when no daemon has written one yet", async () => {
  clearInstanceInfo();
  const app = createApp(localCfg());
  const put = await app.request("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hideTrayIcon: true }),
  });
  expect(put.status).toBe(200);
  expect(readInstanceInfo()).toBeNull(); // updateInstanceInfo() no-ops when no pointer exists
});
