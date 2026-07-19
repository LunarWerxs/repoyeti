import { describe, it, expect, beforeEach } from "vitest";
import { nextTick } from "vue";
import {
  isSectionCollapsed,
  toggleSection,
  expandSection,
  resetSectionCollapse,
} from "@/lib/repo-sections";

// Collapsing a dashboard section is only worth anything if it STAYS collapsed, so the state has
// to survive a reload. These pin both halves: the toggle behaves, and what it writes is what a
// fresh page load would read back.

const KEY = "repoyeti:sectionsCollapsed";

describe("repo section collapse", () => {
  beforeEach(() => {
    resetSectionCollapse();
    localStorage.clear();
  });

  it("starts expanded, so a first run shows every repo", () => {
    expect(isSectionCollapsed("pinned")).toBe(false);
    expect(isSectionCollapsed("starred")).toBe(false);
    expect(isSectionCollapsed("other")).toBe(false);
  });

  it("toggles one section without touching the others", () => {
    toggleSection("starred");
    expect(isSectionCollapsed("starred")).toBe(true);
    expect(isSectionCollapsed("pinned")).toBe(false);
    expect(isSectionCollapsed("other")).toBe(false);

    toggleSection("starred");
    expect(isSectionCollapsed("starred")).toBe(false);
  });

  // The storage write lands on the ref's watcher, so it needs a tick to flush — reading
  // localStorage synchronously after a toggle sees the previous value.
  it("writes through to localStorage, which is what makes it survive a reload", async () => {
    toggleSection("other");
    await nextTick();
    // Reassignment, not in-place mutation, is what trips the write — a property set on the
    // stored object can leave localStorage holding the previous value.
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ other: true });
  });

  it("keeps every collapsed section across separate toggles", async () => {
    toggleSection("pinned");
    toggleSection("other");
    await nextTick();
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    expect(stored.pinned).toBe(true);
    expect(stored.other).toBe(true);
  });

  it("expandSection is idempotent and only ever opens", () => {
    expandSection("pinned");
    expect(isSectionCollapsed("pinned")).toBe(false);

    toggleSection("pinned");
    expect(isSectionCollapsed("pinned")).toBe(true);
    expandSection("pinned");
    expandSection("pinned");
    expect(isSectionCollapsed("pinned")).toBe(false);
  });
});
