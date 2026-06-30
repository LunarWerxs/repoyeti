import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { provideTreeSelection, type TreeSelectionApi } from "@/lib/changes-selection";

// The selection store uses provide/inject + reactive Set + persistence — all of which need a real
// component setup() context. Mount a throwaway host that provides it and hand the API back.
function makeSelection(repoId: string): TreeSelectionApi {
  let api!: TreeSelectionApi;
  const Host = defineComponent({
    setup() {
      api = provideTreeSelection(repoId);
      return () => h("div");
    },
  });
  mount(Host);
  return api;
}

describe("changes-selection store", () => {
  beforeEach(() => localStorage.clear());

  it("toggles a path in and out, tracking the reactive count", () => {
    const sel = makeSelection("r1");
    expect(sel.count.value).toBe(0);
    sel.toggle("a.txt");
    expect(sel.isSelected("a.txt")).toBe(true);
    expect(sel.count.value).toBe(1);
    sel.toggle("a.txt");
    expect(sel.isSelected("a.txt")).toBe(false);
    expect(sel.count.value).toBe(0);
  });

  it("setMany adds or removes a batch (folder / select-all behaviour)", () => {
    const sel = makeSelection("r2");
    sel.setMany(["a", "b", "c"], true);
    expect(sel.count.value).toBe(3);
    sel.setMany(["a", "b"], false);
    expect([...sel.selected].sort()).toEqual(["c"]);
  });

  it("prune drops selected paths that are no longer pending (PLAN_STALE guard)", () => {
    const sel = makeSelection("r3");
    sel.setMany(["keep.txt", "gone.txt"], true);
    sel.prune(["keep.txt", "other.txt"]); // gone.txt no longer in the changed set
    expect(sel.isSelected("keep.txt")).toBe(true);
    expect(sel.isSelected("gone.txt")).toBe(false);
    expect(sel.count.value).toBe(1);
  });

  it("clear empties the whole selection", () => {
    const sel = makeSelection("r4");
    sel.setMany(["a", "b"], true);
    sel.clear();
    expect(sel.count.value).toBe(0);
  });

  it("isSelected reflects the current set without mutating it", () => {
    const sel = makeSelection("r5");
    sel.setMany(["a", "b"], true);
    expect(sel.isSelected("a")).toBe(true);
    expect(sel.isSelected("nope")).toBe(false);
    expect(sel.count.value).toBe(2); // queries don't change the selection
  });

  // NB: localStorage persistence (selection surviving the SSE-driven card re-render) is exercised
  // in the browser verification, not here — @vueuse's useLocalStorage couples to module-load timing
  // and async watcher flush, which is awkward and low-value to assert in-process.
});
