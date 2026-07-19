<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { dragAndDrop } from "@formkit/drag-and-drop/vue";
import { insert, tearDown } from "@formkit/drag-and-drop";
import { Pin, Star, FolderGit2 } from "@lucide/vue";
import { useStore } from "../store";
import { isSectionCollapsed, toggleSection, type RepoSection } from "@/lib/repo-sections";
import type { Repo } from "../types";
import RepoCard from "./RepoCard.vue";
import RepoSectionHeader from "./RepoSectionHeader.vue";

const store = useStore();

// The dashboard splits the *visible* repos into three sections (Pinned, Starred, rest),
// each its own independent drag list — you reorder within a section, and move a repo
// between sections via its ⋮ menu (Pin / Star). We keep local arrays bound to the drag
// library and rebuild them only when membership/flags change — NOT on live SSE status
// patches, which mutate the shared repo objects in place (so cards update without a
// disruptive reassignment mid-drag). Precedence (pinned > starred > rest) lives in the
// store so a repo never renders in two sections.
const pinnedList = ref<Repo[]>([]);
const starredList = ref<Repo[]>([]);
const otherList = ref<Repo[]>([]);

function rebuild(): void {
  pinnedList.value = [...store.pinnedRepos];
  starredList.value = [...store.starredRepos];
  otherList.value = [...store.otherRepos];
}
watch(
  () => store.visibleRepos.map((r) => `${r.id}:${r.pinned ? 1 : 0}:${r.starred ? 1 : 0}`).join(","),
  rebuild,
  { immediate: true },
);

const hasSections = computed(() => pinnedList.value.length > 0 || starredList.value.length > 0);

// The catch-all section shows a heading only when a section above it exists — alone on the page
// it is just "the list", and needs no label. That heading is also its collapse control, so
// without it the section must stay open: otherwise unpinning your last pinned repo would take
// the header away while "other" was folded, leaving an empty dashboard and nothing to click.
// The stored preference is left untouched, so it comes back the moment the heading does.
const otherCollapsible = computed(() => hasSections.value);
function sectionCollapsed(section: RepoSection): boolean {
  if (section === "other" && !otherCollapsible.value) return false;
  return isSectionCollapsed(section);
}

// Persist the global order as pinned-block → starred-block → rest-block, then append any
// repo NOT in the visible drag set (hidden ones) so they keep a stable spot. The daemon
// stores one global sort_order; the section filters re-derive the grouping from it.
function persist(): void {
  const ids = [...pinnedList.value, ...starredList.value, ...otherList.value].map((r) => r.id);
  const seen = new Set(ids);
  const tail = store.repos.filter((r) => !seen.has(r.id)).map((r) => r.id);
  void store.persistRepoOrder([...ids, ...tail]);
}

const pinnedParent = ref<HTMLElement>();
const starredParent = ref<HTMLElement>();
const otherParent = ref<HTMLElement>();
// `nativeDrag: false` was meant to route every pointer through the library's own synthetic
// dragger (avoiding native HTML5 drag's fast-flick-drop quirk), but that synthetic path
// (handleRootPointermove in @formkit/drag-and-drop) explicitly bails out for
// `pointerType === "mouse"` on non-mobile platforms, so with nativeDrag off AND the
// synthetic fallback self-excluding desktop mouse, a mouse drag had NO code path that could
// complete a reorder at all (confirmed by reading the installed library's source). Native
// drag (the library default) is the only path that handles desktop mouse in this version, so
// we use it.
//
// longPress is a TOUCH affordance only: it stops a finger-scroll over a card from being read as
// a drag. Desktop mouse always takes the native path and never needs (or waits on) it, so we arm
// it only when a touch input actually exists — a pure-mouse machine gets an instant grab.
const hasCoarsePointer =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(any-pointer: coarse)").matches
    : false;

// The insert() plugin's marker element: a literal insertion line drawn BETWEEN cards at the exact
// spot the drop will land. The plugin appends this to <body> and owns its position/width inline —
// it only measures our height — so the paint lives in the global `.repo-insert-line` (style.css),
// not a scoped block that could never reach a body-level node. Called fresh per drag target.
function makeInsertPoint(): HTMLElement {
  const el = document.createElement("div");
  el.className = "repo-insert-line";
  return el;
}

// Visual feedback classes handed to the library (it space-splits these into classList):
//   · draggingClass       — transient, applied the instant a drag starts
//   · dragPlaceholderClass — persists on the picked-up card for the whole drag (the "hole" it
//                            left), so grabbing a card visibly responds right away. The previous
//                            `draggingClass: "dragging"` referenced a class that was never
//                            defined in CSS, so a grab produced NO feedback and felt unresponsive.
//
// insert() REPLACES the default live-sort model rather than decorating it: its handleNodeDragover
// is a bare preventDefault, so cards no longer swap under the cursor — the line shows the landing
// spot and the array is spliced once, on drop. Two options die with that model, deliberately:
//   · animations() — its only hook (setupNodeRemap) branches on state.incomingDirection /
//     targetIndex / affectedNodes, which ONLY the replaced sort() pipeline ever sets. Kept, it
//     would silently no-op — dead weight, not a live-sort visual.
//   · dropZoneClass — insert() never puts it on the hovered CARD anymore (that's the bypassed
//     path); it would instead land on the PARENT, ringing the whole section. The line supersedes it.
// onDragend still fires, and fires AFTER insert()'s splice (it wraps handleEnd: own-then-original),
// so `persist` reads the post-drop order, not a stale one. Verified in the installed v0.6.1 source.
const dragOpts = {
  dragHandle: ".drag-handle",
  draggingClass: "cursor-grabbing",
  dragPlaceholderClass: "opacity-40",
  longPress: hasCoarsePointer,
  longPressDuration: 250,
  plugins: [insert<Repo>({ insertPoint: makeInsertPoint })],
};
dragAndDrop({ parent: pinnedParent, values: pinnedList, onDragend: persist, ...dragOpts });
dragAndDrop({ parent: starredParent, values: starredList, onDragend: persist, ...dragOpts });
dragAndDrop({ parent: otherParent, values: otherList, onDragend: persist, ...dragOpts });

// `dragAndDrop` (unlike `useDragAndDrop`) wires no teardown — clean up if we unmount.
onBeforeUnmount(() => {
  for (const p of [pinnedParent, starredParent, otherParent]) if (p.value) tearDown(p.value);
  // insert()'s marker lives on <body>, outside our tree, and NOTHING in the library removes it for
  // us: on drop it's only hidden (display:none), the exported tearDown never touches the plugin's
  // insertState, and the plugin's own cleanup hook is unreachable (it spells the key `teardown`
  // while the caller invokes `tearDown?.()`). So a filter-to-zero unmount would orphan it on body.
  for (const el of document.querySelectorAll(".repo-insert-line")) el.remove();
});
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Each list stays MOUNTED when collapsed, never v-if / v-show: the drag library holds a
         reference to these exact parent elements, so unmounting one would strand its instance,
         and `display: none` can't be animated. `.section-collapse` animates grid-template-rows
         1fr↔0fr instead, which needs no measured height and clips via the inner overflow. -->


    <!-- Pinned -->
    <section v-show="pinnedList.length">
      <RepoSectionHeader
        :icon="Pin"
        icon-class="text-primary"
        :label="$t('shell.sectionPinned')"
        :count="pinnedList.length"
        :collapsed="sectionCollapsed('pinned')"
        collapsible
        @toggle="toggleSection('pinned')"
      />
      <div class="section-collapse" :class="sectionCollapsed('pinned') && 'is-collapsed'">
        <div class="section-collapse-inner">
          <div ref="pinnedParent" class="flex flex-col gap-2.5">
            <RepoCard v-for="repo in pinnedList" :key="repo.id" :repo="repo" section="pinned" :draggable="store.sortMode === 'manual' && !store.isGuest" />
          </div>
        </div>
      </div>
    </section>

    <!-- Starred -->
    <section v-show="starredList.length">
      <RepoSectionHeader
        :icon="Star"
        icon-class="fill-current text-warning"
        :label="$t('shell.sectionStarred')"
        :count="starredList.length"
        :collapsed="sectionCollapsed('starred')"
        collapsible
        @toggle="toggleSection('starred')"
      />
      <div class="section-collapse" :class="sectionCollapsed('starred') && 'is-collapsed'">
        <div class="section-collapse-inner">
          <div ref="starredParent" class="flex flex-col gap-2.5">
            <RepoCard v-for="repo in starredList" :key="repo.id" :repo="repo" section="starred" :draggable="store.sortMode === 'manual' && !store.isGuest" />
          </div>
        </div>
      </div>
    </section>

    <!-- Everything else (header shown only when a section above it exists) -->
    <section v-show="otherList.length">
      <RepoSectionHeader
        v-show="hasSections"
        :icon="FolderGit2"
        :label="$t('shell.sectionAll')"
        :count="otherList.length"
        :collapsed="sectionCollapsed('other')"
        :collapsible="otherCollapsible"
        @toggle="toggleSection('other')"
      />
      <div class="section-collapse" :class="sectionCollapsed('other') && 'is-collapsed'">
        <div class="section-collapse-inner">
          <div ref="otherParent" class="flex flex-col gap-2.5">
            <RepoCard v-for="repo in otherList" :key="repo.id" :repo="repo" section="other" :draggable="store.sortMode === 'manual' && !store.isGuest" />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Collapse without unmounting: animate the grid track from 1fr to 0fr. No height measuring, and
   the list keeps its DOM (and so its drag-and-drop registration) the whole time. */
.section-collapse {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 0.22s ease;
}
.section-collapse.is-collapsed {
  grid-template-rows: 0fr;
}
.section-collapse-inner {
  min-height: 0;
  overflow: hidden;
}
/* A collapsed section must not leave its cards focusable or hit-testable behind a 0px track. */
.section-collapse.is-collapsed .section-collapse-inner {
  visibility: hidden;
  transition: visibility 0s linear 0.22s;
}

@media (prefers-reduced-motion: reduce) {
  .section-collapse {
    transition: none;
  }
}
</style>
