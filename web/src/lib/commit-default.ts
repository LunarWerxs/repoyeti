// Which action the main commit split-button performs.
//
// This is a client-side appearance/workflow preference, like the changed-files height and
// history-file view. Keep it local to the browser (no daemon setting): changing it should take
// effect immediately on every repo card and survive a reload.

import { useLocalStorage } from "@vueuse/core";
import { computed } from "vue";

export type DefaultCommitAction = "commit" | "sync";

export const DEFAULT_COMMIT_ACTION_STORAGE_KEY = "repoyeti:defaultCommitAction";

// Read as a string so a stale/manually-edited storage value cannot escape the public type. The
// writable computed normalises every unknown value back to the conservative plain-commit default.
const storedAction = useLocalStorage<string>(DEFAULT_COMMIT_ACTION_STORAGE_KEY, "commit");

export const defaultCommitAction = computed<DefaultCommitAction>({
  get: () => (storedAction.value === "sync" ? "sync" : "commit"),
  set: (action) => {
    storedAction.value = action === "sync" ? "sync" : "commit";
  },
});

/** Commit & Sync needs a sync target. Repos without one always fall back to a local commit. */
export function resolveDefaultCommitAction(
  preferred: DefaultCommitAction,
  canSync: boolean,
): DefaultCommitAction {
  return preferred === "sync" && canSync ? "sync" : "commit";
}
