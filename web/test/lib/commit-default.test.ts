import { beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import {
  DEFAULT_COMMIT_ACTION_STORAGE_KEY,
  defaultCommitAction,
  resolveDefaultCommitAction,
} from "@/lib/commit-default";

describe("default commit action preference", () => {
  beforeEach(() => {
    localStorage.clear();
    defaultCommitAction.value = "commit";
  });

  it("persists the selected action in localStorage", async () => {
    defaultCommitAction.value = "sync";
    await nextTick();

    expect(defaultCommitAction.value).toBe("sync");
    expect(localStorage.getItem(DEFAULT_COMMIT_ACTION_STORAGE_KEY)).toBe("sync");
  });

  it("uses Commit & Sync only when the repo has an upstream", () => {
    expect(resolveDefaultCommitAction("sync", true)).toBe("sync");
    expect(resolveDefaultCommitAction("sync", false)).toBe("commit");
    expect(resolveDefaultCommitAction("commit", true)).toBe("commit");
  });
});
