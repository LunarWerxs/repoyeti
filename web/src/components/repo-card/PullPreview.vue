<script setup lang="ts">
// "What would a pull do?" — the dialog behind the caret next to Pull.
//
// Everything shown here is read out of objects git already has locally (see
// src/read/incoming.ts): `git pull` is `fetch` + `merge`, and the fetch half is what downloads
// the commits. So this fetches, then describes, and nothing has touched the working tree by the
// time you're looking at it. The merge is simulated in the object store too, which is how the
// conflict warning can be honest BEFORE you pull rather than after you're mid-merge.
import { computed, ref, watch } from "vue";
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  ChevronDown,
  FileQuestion,
  GitCommitHorizontal,
  Loader2,
} from "@lucide/vue";
import { useStore } from "../../store";
import { fromNow } from "@/lib/util";
import { buildChangeTree } from "@/lib/util";
import { provideTreeCollapse } from "@/lib/changes-tree";
import { provideTreeSelection } from "@/lib/changes-selection";
import ChangesTree from "../ChangesTree.vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChangedFile } from "../../types";

const props = defineProps<{ repoId: string; disabled?: boolean }>();
const emit = defineEmits<{ pull: [] }>();
const store = useStore();

const open = ref(false);
const result = computed(() => store.incomingByRepo[props.repoId]);
const loading = computed(() => !!store.incomingLoading[props.repoId]);

// Re-fetch every time the dialog opens: a preview from five minutes ago is not a preview.
watch(open, (isOpen) => {
  if (isOpen) void store.loadIncoming(props.repoId);
});

const commits = computed(() => result.value?.commits ?? []);
const conflicts = computed(() => result.value?.conflicts ?? []);
const hasIncoming = computed(() => commits.value.length > 0);

// Reuse the card's changed-files tree so this reads exactly like the source-control panel.
// IncomingFile → ChangedFile is a straight shape map; the tree only needs path/status/stat.
const incomingAsChanges = computed<ChangedFile[]>(() =>
  (result.value?.files ?? []).map((f) => ({
    path: f.path,
    status: f.status,
    staged: false,
    stat: f.binary
      ? undefined
      : { addedLines: f.addedLines, removedLines: f.removedLines, addedChars: 0, removedChars: 0 },
  })),
);
const tree = computed(() => buildChangeTree(incomingAsChanges.value));

// The tree component injects both of these. Scoped to a preview-only key so expanding folders
// here can't disturb the real source-control tree's persisted collapse state for this repo.
provideTreeCollapse(`incoming:${props.repoId}`);
provideTreeSelection(`incoming:${props.repoId}`);

/** Pull, then close. The parent owns the actual action (and its toast). */
function pullNow(): void {
  open.value = false;
  emit("pull");
}
</script>

<template>
  <!-- caret beside Pull: same height, joined to it visually -->
  <Button
    variant="outline"
    size="sm"
    class="h-8 w-7 px-0"
    :disabled="disabled"
    :aria-label="$t('repo.preview.open')"
    :title="$t('repo.preview.open')"
    @click="open = true"
  >
    <ChevronDown :size="14" />
  </Button>

  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader class="min-w-0">
        <DialogTitle class="flex items-center gap-2">
          <ArrowDownToLine :size="16" class="shrink-0 text-muted-foreground" />
          {{ $t("repo.preview.title") }}
        </DialogTitle>
        <DialogDescription>
          <template v-if="loading">{{ $t("repo.preview.checking") }}</template>
          <template v-else-if="result?.noUpstream">{{ $t("repo.preview.noUpstream") }}</template>
          <template v-else-if="result && !result.ok">{{ result.message || $t("repo.preview.failed") }}</template>
          <template v-else-if="!hasIncoming">{{ $t("repo.preview.upToDate") }}</template>
          <template v-else>
            {{ $t("repo.preview.summary", {
              commits: commits.length,
              files: result!.stat.filesChanged,
              upstream: result!.upstream,
            }) }}
          </template>
        </DialogDescription>
      </DialogHeader>

      <div v-if="loading" class="flex items-center gap-2 py-8 text-[13px] text-muted-foreground">
        <Loader2 :size="15" class="animate-spin" />{{ $t("repo.preview.checking") }}
      </div>

      <template v-else-if="hasIncoming">
        <!-- conflict verdict: the reason this is worth opening before you pull -->
        <div
          v-if="conflicts.length"
          class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive"
        >
          <AlertTriangle :size="15" class="mt-px shrink-0" />
          <div class="min-w-0">
            <div class="font-medium">{{ $t("repo.preview.willConflict", { count: conflicts.length }, conflicts.length) }}</div>
            <ul class="mono mt-1 space-y-0.5 text-[11.5px] opacity-90">
              <li v-for="p in conflicts.slice(0, 8)" :key="p" class="truncate">{{ p }}</li>
              <li v-if="conflicts.length > 8" class="opacity-70">
                {{ $t("repo.preview.moreConflicts", { count: conflicts.length - 8 }) }}
              </li>
            </ul>
          </div>
        </div>
        <div
          v-else-if="!result!.conflictCheck"
          class="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-[12.5px] text-muted-foreground"
        >
          <FileQuestion :size="15" class="shrink-0" />
          {{ $t("repo.preview.conflictUnknown") }}
        </div>
        <div
          v-else
          class="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-[12.5px] text-success"
        >
          <CheckCircle2 :size="15" class="shrink-0" />
          {{ result!.fastForward ? $t("repo.preview.cleanFastForward") : $t("repo.preview.cleanMerge") }}
        </div>

        <!-- incoming commits -->
        <div class="min-w-0">
          <div class="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <GitCommitHorizontal :size="13" />
            {{ $t("repo.preview.commitsHeading", { count: commits.length }, commits.length) }}
          </div>
          <div class="scroll-slim max-h-44 overflow-y-auto rounded-md border border-border">
            <div
              v-for="c in commits"
              :key="c.hash"
              class="flex items-center gap-2 border-b border-border px-2 py-1 text-[12px] last:border-b-0"
            >
              <span class="mono shrink-0 text-[11px] text-info/80">{{ c.shortHash }}</span>
              <span class="min-w-0 flex-1 truncate" :title="c.subject">{{ c.subject }}</span>
              <span v-if="c.stat" class="mono shrink-0 text-[10.5px]">
                <span class="text-success">+{{ c.stat.addedLines }}</span>
                <span class="ml-1 text-destructive">−{{ c.stat.removedLines }}</span>
              </span>
              <span class="shrink-0 text-[10.5px] whitespace-nowrap text-muted-foreground">{{ fromNow(c.date) }}</span>
            </div>
          </div>
          <p v-if="result!.commitsTruncated" class="mt-1 text-[11px] text-muted-foreground">
            {{ $t("repo.preview.commitsTruncated") }}
          </p>
        </div>

        <!-- incoming files, in the same tree the source-control panel uses -->
        <div class="min-w-0">
          <div class="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {{ $t("repo.preview.filesHeading", { count: result!.stat.filesChanged }, result!.stat.filesChanged) }}
            <span class="mono ml-auto normal-case">
              <span class="text-success">+{{ result!.stat.addedLines }}</span>
              <span class="ml-1 text-destructive">−{{ result!.stat.removedLines }}</span>
            </span>
          </div>
          <div class="scroll-slim max-h-56 overflow-y-auto rounded-md border border-border p-1">
            <!-- read-only: no discard/stage/open here, these files don't exist locally yet -->
            <ChangesTree :nodes="tree" :repo-id="repoId" :can-control="false" is-guest read-only />
          </div>
          <p v-if="result!.filesTruncated" class="mt-1 text-[11px] text-muted-foreground">
            {{ $t("repo.preview.filesTruncated") }}
          </p>
        </div>
      </template>

      <DialogFooter>
        <Button variant="ghost" @click="open = false">{{ $t("common.close") }}</Button>
        <Button
          :disabled="!hasIncoming || loading"
          :variant="conflicts.length ? 'secondary' : 'default'"
          @click="pullNow"
        >
          <ArrowDownToLine />
          {{ conflicts.length ? $t("repo.preview.pullAnyway") : $t("repo.actions.pull") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
