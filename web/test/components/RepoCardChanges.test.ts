import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import RepoCardChanges from "@/components/repo-card/RepoCardChanges.vue";
import { i18n } from "@/i18n";
import { changesTreeStyle, changesViewSize, clearChangesOverride } from "@/lib/changes-view";
import { useStore } from "@/store";
import type { Repo } from "@/types";

// ChangesTree's icon lookup imports ~icons/* virtual modules, while the deliberately small test
// Vite config omits unplugin-icons. Glyph choice is irrelevant to resize behavior.
vi.mock("@/lib/file-icons", () => ({ fileVisual: () => "span" }));

const repoId = "resize-repo";
const repo: Repo = {
  id: repoId,
  name: "resize-repo",
  displayName: null,
  absPath: "C:/resize-repo",
  source: "auto",
  vcs: "git",
  isSubmodule: false,
  identityId: null,
  syncAccountHost: null,
  syncAccountLogin: null,
  hidden: false,
  pinned: false,
  starred: false,
  autoCommit: false,
  status: {
    branch: "main",
    detached: false,
    dirty: 1,
    ahead: 0,
    behind: 0,
    remote: null,
    error: null,
    fetchedAt: null,
    updatedAt: 0,
  },
  updatedAt: 0,
};

const passThrough = { template: "<div><slot /></div>" };
const inlinePassThrough = { template: "<span><slot /></span>" };
const expandTransition = {
  props: ["open"],
  template: '<div v-if="open"><slot /></div>',
};

let wrapper: ReturnType<typeof mount> | undefined;
let resizeCallback: ResizeObserverCallback | undefined;

class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function mountChanges() {
  return mount(RepoCardChanges, {
    props: {
      repo,
      treeQuery: "",
      contentMode: false,
      "onUpdate:treeQuery": () => {},
      "onUpdate:contentMode": () => {},
    },
    global: {
      plugins: [i18n],
      stubs: {
        BranchPanel: true,
        ChangesTree: true,
        RepoCardMenu: true,
        ExpandTransition: expandTransition,
        Tooltip: passThrough,
        TooltipTrigger: inlinePassThrough,
        TooltipContent: inlinePassThrough,
        Dialog: passThrough,
        DialogContent: passThrough,
        DialogHeader: passThrough,
        DialogTitle: passThrough,
        DialogDescription: passThrough,
        DialogFooter: passThrough,
      },
    },
  });
}

function notifyContentResize(): void {
  resizeCallback?.([], {} as ResizeObserver);
}

describe("RepoCardChanges changed-files resize grip", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    resizeCallback = undefined;
    setActivePinia(createPinia());
    clearChangesOverride(repoId);
    changesViewSize.value = "medium";
    localStorage.clear();
    const store = useStore();
    store.changesByRepo[repoId] = [{ path: "only-file.ts", status: "M", staged: false }];
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    clearChangesOverride(repoId);
    vi.unstubAllGlobals();
  });

  it("drags beyond short content, persists the exact height, and double-click resets it", async () => {
    wrapper = mountChanges();

    const scroller = wrapper.find<HTMLElement>(".scroll-slim");
    const content = wrapper.find<HTMLElement>(".changes-tree-content");
    const grip = wrapper.find<HTMLButtonElement>('button[aria-label="Resize changes list"]');
    expect(scroller.exists()).toBe(true);
    expect(grip.exists()).toBe(true);
    expect(content.classes()).toContain("pb-2.5");

    // Model a very short tree. The regression clamped the resize to this scrollHeight, so a
    // downward drag could never create a taller workspace.
    Object.defineProperty(scroller.element, "clientHeight", { configurable: true, value: 120 });
    Object.defineProperty(scroller.element, "scrollHeight", { configurable: true, value: 120 });

    grip.element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientY: 100,
        isPrimary: true,
        pointerId: 7,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        clientY: 2_100,
        isPrimary: true,
        pointerId: 7,
      }),
    );
    await nextTick();

    expect(scroller.attributes("style")).toContain("height: 2120px");
    expect(scroller.classes()).toContain("changes-tree-viewport--dragging");

    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        buttons: 0,
        clientY: 2_100,
        isPrimary: true,
        pointerId: 7,
      }),
    );
    await nextTick();

    expect(changesTreeStyle(repoId)).toEqual({ height: "2120px" });
    expect(scroller.attributes("style")).toContain("height: 2120px");
    expect(scroller.classes()).not.toContain("changes-tree-viewport--dragging");

    await grip.trigger("dblclick");
    expect(changesTreeStyle(repoId)).toEqual({ maxHeight: "340px" });
    expect(scroller.attributes("style")).toContain("max-height: 340px");
    expect(scroller.attributes("style")).not.toContain("height: 2120px");
  });

  it("automatically grows and shrinks with rendered rows up to the Appearance preset", async () => {
    wrapper = mountChanges();
    await nextTick();

    const scroller = wrapper.find<HTMLElement>(".scroll-slim");
    const content = wrapper.find<HTMLElement>(".changes-tree-content");
    let contentHeight = 120;
    Object.defineProperty(content.element, "scrollHeight", {
      configurable: true,
      get: () => contentHeight,
    });

    notifyContentResize();
    await nextTick();
    expect(scroller.attributes("style")).toContain("height: 120px");
    expect(scroller.attributes("style")).toContain("max-height: 340px");

    contentHeight = 280;
    notifyContentResize();
    await nextTick();
    expect(scroller.attributes("style")).toContain("height: 280px");

    contentHeight = 500;
    notifyContentResize();
    await nextTick();
    expect(scroller.attributes("style")).toContain("height: 340px");

    contentHeight = 96;
    notifyContentResize();
    await nextTick();
    expect(scroller.attributes("style")).toContain("height: 96px");
  });
});
