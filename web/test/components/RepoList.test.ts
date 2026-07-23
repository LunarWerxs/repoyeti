// Pins the share-link regression where a guest saw a flat, unlabelled repo list: the daemon used
// to flatten every repo's `pinned`/`starred` to false before handing a snapshot to a guest viewer,
// so RepoList (shared verbatim between the owner and a guest) always fell into its single
// no-sections layout — cards with no Pinned/Starred grouping and, worse, no heading at all above
// them, since the catch-all "All repositories" header only renders once some OTHER section exists
// above it. That server-side flattening is now fixed; this test locks the client-side half of the
// contract so nobody can reintroduce the bug by only fixing the daemon (or by editing RepoList's
// section-visibility logic) without a test going red.
//
// Sectioning here is entirely guest-agnostic — `hasSections`/`otherCollapsible` in RepoList.vue
// derive purely from each repo's `pinned`/`starred` booleans, never from `store.isGuest` (that flag
// only gates whether cards are draggable). So there is no guest state to fake: feeding the store
// flattened flags (as the daemon used to for a guest) reproduces the bug exactly, and feeding it
// real flags (as the daemon now sends to everyone) reproduces the fix — both without touching
// isGuest at all.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { i18n } from "@/i18n";
import { useStore } from "@/store";
import { resetSectionCollapse } from "@/lib/repo-sections";
import RepoList from "@/components/RepoList.vue";
import RepoSectionHeader from "@/components/RepoSectionHeader.vue";
import type { Repo } from "@/types";

// RepoCard drags in the whole card stack (header/changes/commit/actions/LogPanel) — heavy and
// irrelevant to section layout. Stub it down to something that still tells us which repo landed
// in which section, via plain data attributes we can query.
vi.mock("@/components/RepoCard.vue", () => ({
  default: {
    name: "RepoCard",
    props: ["repo", "draggable", "section"],
    template: '<div class="repo-card-stub" :data-repo-id="repo.id" :data-section="section">{{ repo.name }}</div>',
  },
}));

// @formkit/drag-and-drop wires native HTML5 drag listeners and drops an `insert()` marker element
// on <body> — none of it is exercised by this test (no drag is simulated), and none of it is
// reliable to spin up under happy-dom. Stub both entry points to inert no-ops, the same way
// LogPanel.test.ts stubs @/lib/file-icons for a dependency the test pipeline can't run.
vi.mock("@formkit/drag-and-drop/vue", () => ({ dragAndDrop: vi.fn() }));
vi.mock("@formkit/drag-and-drop", () => ({ insert: vi.fn(() => ({})), tearDown: vi.fn() }));

function repo(patch: Partial<Repo> = {}): Repo {
  return {
    id: "repo-1",
    name: "repo-1",
    displayName: null,
    absPath: "C:/repo-1",
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
    status: null,
    updatedAt: 0,
    ...patch,
  };
}

let activeWrapper: ReturnType<typeof mount> | undefined;

// `attachTo: document.body` matters here, not just tidiness: happy-dom only resolves
// getComputedStyle()'s display/visibility (what isVisible() below reads) for elements that are
// actually connected to the document — an unattached wrapper reports every v-show'd node as
// "visible" regardless of its style, which would make this whole test meaningless.
function mountRepoList() {
  activeWrapper = mount(RepoList, { global: { plugins: [i18n] }, attachTo: document.body });
  return activeWrapper;
}

/** Card stub ids visible under a given `[data-section]` group. */
function cardIdsIn(wrapper: ReturnType<typeof mountRepoList>, section: "pinned" | "starred" | "other"): string[] {
  return wrapper
    .findAll(`.repo-card-stub[data-section="${section}"]`)
    .map((c) => c.attributes("data-repo-id")!);
}

describe("RepoList.vue section headers (guest-link regression)", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    resetSectionCollapse(); // every section starts expanded, like a first-ever load
  });

  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = undefined;
    vi.restoreAllMocks();
  });

  it("with a pinned, a starred, and two plain repos, renders Pinned/Starred/All headers, each visible and correctly populated", async () => {
    const store = useStore();
    store.repos.push(
      repo({ id: "p1", name: "pinned-one", pinned: true }),
      repo({ id: "s1", name: "starred-one", starred: true }),
      repo({ id: "o1", name: "other-one" }),
      repo({ id: "o2", name: "other-two" }),
    );

    const wrapper = mountRepoList();
    await wrapper.vm.$nextTick();

    const headers = wrapper.findAllComponents(RepoSectionHeader);
    expect(headers).toHaveLength(3);
    const byLabel = (label: string) => headers.find((h) => h.props("label") === label)!;

    const pinnedHeader = byLabel("Pinned");
    const starredHeader = byLabel("Starred");
    const allHeader = byLabel("All repositories");

    // All three sections exist and are actually on screen (not just present-but-hidden).
    expect(pinnedHeader.isVisible()).toBe(true);
    expect(starredHeader.isVisible()).toBe(true);
    expect(allHeader.isVisible()).toBe(true);

    // The catch-all heading is collapsible here (a section above it exists): it renders as a
    // real <button> with an aria-expanded collapse state, not the inert <div> it falls back to
    // when it's the only thing on the page.
    expect(allHeader.props("collapsible")).toBe(true);
    expect(allHeader.element.tagName).toBe("BUTTON");
    expect(allHeader.attributes("aria-expanded")).toBe("true"); // expanded by default

    // Each repo landed in exactly the section its flags say it should.
    expect(cardIdsIn(wrapper, "pinned")).toEqual(["p1"]);
    expect(cardIdsIn(wrapper, "starred")).toEqual(["s1"]);
    expect(cardIdsIn(wrapper, "other")).toEqual(["o1", "o2"]);
  });

  it("REGRESSION: with every repo's pinned/starred flattened to false, only the plain list renders and its heading stays hidden", async () => {
    // This is exactly the shape the daemon used to hand a guest: real repos, but pinned/starred
    // force-cleared. Before the server-side fix, an owner's carefully pinned/starred repos would
    // reach the guest exactly like this — indistinguishable from having none at all.
    const store = useStore();
    store.repos.push(
      repo({ id: "o1", name: "other-one", pinned: false, starred: false }),
      repo({ id: "o2", name: "other-two", pinned: false, starred: false }),
    );

    const wrapper = mountRepoList();
    await wrapper.vm.$nextTick();

    const headers = wrapper.findAllComponents(RepoSectionHeader);
    // No header is shown: Pinned/Starred have nothing to hold, and the catch-all only labels
    // itself when a section above it exists — alone on the page it's just "the list".
    for (const h of headers) expect(h.isVisible()).toBe(false);

    // The repos themselves are still there, ungrouped, under "other" — a flat list, not an
    // empty dashboard.
    expect(cardIdsIn(wrapper, "pinned")).toEqual([]);
    expect(cardIdsIn(wrapper, "starred")).toEqual([]);
    expect(cardIdsIn(wrapper, "other")).toEqual(["o1", "o2"]);
  });
});
