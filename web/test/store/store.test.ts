import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useStore } from "@/store";

// Minimal Response-like for the api.ts `req()` helper (it reads .ok/.status and awaits .text()).
function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? "OK" : "ERR", text: async () => JSON.stringify(body) };
}

describe("store (smoke)", () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => vi.restoreAllMocks());

  it("starts empty with AI disabled by default", () => {
    const store = useStore();
    expect(store.repos).toEqual([]);
    expect(store.aiEnabled).toBe(false); // no default provider configured
  });

  it("loadChanges populates changesByRepo from the API", async () => {
    const files = [
      { path: "src/a.ts", status: "M", staged: false },
      { path: "b.txt", status: "A", staged: false },
    ];
    const fetchMock = vi.fn(async () => jsonResponse({ files }));
    vi.stubGlobal("fetch", fetchMock);

    const store = useStore();
    await store.loadChanges("repo-1");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain("/api/repos/repo-1/changes");
    expect(store.changesByRepo["repo-1"]).toEqual(files);
    expect(store.changesLoading["repo-1"]).toBe(false);
  });

  it("loadChanges degrades to an empty list when the API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ code: "ERROR", message: "boom" }, false, 500)));
    const store = useStore();
    await store.loadChanges("repo-2");
    expect(store.changesByRepo["repo-2"]).toEqual([]);
  });
});
