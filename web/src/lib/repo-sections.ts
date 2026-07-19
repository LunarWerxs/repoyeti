// Collapsed/expanded state for the dashboard's repo sections (Pinned, Starred, everything else).
//
// Persisted, because the whole point is a layout you set up once: someone who keeps twelve pinned
// repos and eighty others wants the long tail folded away and expects it to STAY folded across a
// reload. That makes it a per-browser view preference, not server state — the same reasoning as
// the changed-files height in @/lib/changes-view.
import { useLocalStorage } from "@vueuse/core";

export type RepoSection = "pinned" | "starred" | "other";

/** section → collapsed. Absent = expanded, so a first run shows everything. */
const collapsed = useLocalStorage<Partial<Record<RepoSection, boolean>>>(
  "repoyeti:sectionsCollapsed",
  {},
);

export function isSectionCollapsed(section: RepoSection): boolean {
  return collapsed.value[section] === true;
}

export function toggleSection(section: RepoSection): void {
  // Reassign rather than mutate a key in place: useLocalStorage writes through on the ref, and
  // an in-place property set on the stored object isn't guaranteed to trip that write.
  collapsed.value = { ...collapsed.value, [section]: !isSectionCollapsed(section) };
}

/** Expand a section unconditionally (used to rescue one whose header is no longer rendered). */
export function expandSection(section: RepoSection): void {
  if (!isSectionCollapsed(section)) return;
  collapsed.value = { ...collapsed.value, [section]: false };
}

/** Test seam — drops every stored preference. */
export function resetSectionCollapse(): void {
  collapsed.value = {};
}
