// Controls how tall the per-repo changed-files tree is.
//
// ONE rule, applied at two scopes: a height here is always a CAP, never a fixed size. The list
// grows with its content and starts scrolling once it hits the cap.
//   1. A global default (small / medium / tall) chosen in Settings.
//   2. An optional per-repo cap set by dragging the resize grip on a card, which wins for
//      that repo until it's reset.
//
// The per-repo value used to be a fixed `height`, and that was a trap: nudging the grip on a
// repo with one changed file left a mostly-empty tall box forever, and silently made the
// Settings preset look broken for that card (the fixed height simply won). Capping instead
// means a stray drag can never produce dead space — the worst it does is cap you lower.
import { useLocalStorage } from "@vueuse/core";

export type ChangesViewSize = "small" | "medium" | "tall";

/** Preset → max-height in px (the default, fit-to-content cap). */
export const CHANGES_SIZE_PX: Record<ChangesViewSize, number> = {
  small: 200,
  medium: 340,
  tall: 560,
};

/** Clamp range for the drag-to-resize override. */
export const MIN_CHANGES_PX = 96;
export const MAX_CHANGES_PX = 1400;

/** Global default, shared by every card that has no manual override. */
export const changesViewSize = useLocalStorage<ChangesViewSize>("repoyeti:changesViewSize", "medium");

/** repoId → manually-dragged height CAP (px). Absent = use the global preset. */
const overrides = useLocalStorage<Record<string, number>>("repoyeti:changesViewHeights", {});

export function hasChangesOverride(repoId: string): boolean {
  return typeof overrides.value[repoId] === "number";
}

/** The effective cap in px for a repo: its own if it has one, else the global preset. */
export function changesCapPx(repoId: string): number {
  const o = overrides.value[repoId];
  return typeof o === "number" ? o : CHANGES_SIZE_PX[changesViewSize.value];
}

/**
 * The inline style for a card's scroll container. Always a cap: the list is as tall as its
 * content until it reaches this, then scrolls.
 */
export function changesTreeStyle(repoId: string): Record<string, string> {
  return { maxHeight: `${changesCapPx(repoId)}px` };
}

export function setChangesOverride(repoId: string, px: number): void {
  overrides.value[repoId] = Math.min(MAX_CHANGES_PX, Math.max(MIN_CHANGES_PX, Math.round(px)));
}

export function clearChangesOverride(repoId: string): void {
  delete overrides.value[repoId];
}

// ── tree ⇄ list view mode ─────────────────────────────────────────────────────
// The changed files render as a VS Code-style nested folder tree by default; some people
// prefer a flat list of full paths. This is a per-repo client preference (same localStorage
// pattern as the height override above): absent = "tree", so existing cards are unchanged.
export type ChangesDisplayMode = "tree" | "list";

/** repoId → chosen display mode. Absent = "tree" (the default). */
const displayModes = useLocalStorage<Record<string, ChangesDisplayMode>>(
  "repoyeti:changesDisplayMode",
  {},
);

/** The card's current display mode ("tree" unless the owner switched it to "list"). */
export function changesDisplayMode(repoId: string): ChangesDisplayMode {
  return displayModes.value[repoId] === "list" ? "list" : "tree";
}

/** Set (or reset to the default) a card's display mode. Storing "tree" drops the key so the
 *  record only ever holds the non-default choices — matches clearChangesOverride's tidiness. */
export function setChangesDisplayMode(repoId: string, mode: ChangesDisplayMode): void {
  if (mode === "list") displayModes.value[repoId] = "list";
  else delete displayModes.value[repoId];
}
