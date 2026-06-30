<script setup lang="ts">
// Per-repo commit history (lazy + paginated), extracted from RepoCard. Self-contained: it loads
// its own log on first expand and fetches per-commit detail (changed files + bounded diff) on tap,
// keyed by repoId. See @/lib/repo-feedback for the shared error translation.
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { History, ChevronDown, Loader2 } from "@lucide/vue";
import { toast } from "vue-sonner";
import { useStore } from "../store";
import { api, ApiError } from "../api";
import { fromNow } from "@/lib/util";
import { cn } from "@/lib/utils";
import { useRepoFeedback } from "@/lib/repo-feedback";
import type { CommitDetail } from "../types";

const props = defineProps<{ repoId: string }>();
const store = useStore();
const { t } = useI18n();
const { friendly } = useRepoFeedback();

const showHistory = ref(false);
const logResult = computed(() => store.logByRepo[props.repoId]);
const loadingLog = ref(false);
async function toggleHistory(): Promise<void> {
  showHistory.value = !showHistory.value;
  if (showHistory.value && !logResult.value) {
    loadingLog.value = true;
    try {
      await store.loadLog(props.repoId);
    } finally {
      loadingLog.value = false;
    }
  }
}
async function loadMoreLog(): Promise<void> {
  if (loadingLog.value) return;
  loadingLog.value = true;
  try {
    await store.loadLog(props.repoId, 50, logResult.value?.commits.length ?? 0);
  } finally {
    loadingLog.value = false;
  }
}
async function copyHash(hash: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(hash);
    toast.success(t("repo.history.copied"));
  } catch {
    /* clipboard blocked — non-critical */
  }
}

// Per-commit detail (changed files + diff), lazy-loaded + cached when a commit is tapped.
const expandedCommit = ref<string | null>(null);
const commitCache = ref<Record<string, CommitDetail>>({});
const loadingCommit = ref<string | null>(null);
async function toggleCommit(hash: string): Promise<void> {
  if (expandedCommit.value === hash) {
    expandedCommit.value = null;
    return;
  }
  expandedCommit.value = hash;
  if (commitCache.value[hash]) return;
  loadingCommit.value = hash;
  try {
    commitCache.value = { ...commitCache.value, [hash]: await api.commitDetail(props.repoId, hash) };
  } catch (e) {
    const message = e instanceof ApiError ? friendly(e.code) || e.message : t("repo.history.detailUnavailable");
    commitCache.value = {
      ...commitCache.value,
      [hash]: {
        ok: false, code: "ERROR", message,
        hash, shortHash: hash.slice(0, 12), subject: "", authorName: "", authorEmail: "", date: 0,
        files: [], diff: "", truncated: false,
      },
    };
  } finally {
    loadingCommit.value = null;
  }
}
</script>

<template>
  <!-- commit history (lazy-loaded when opened) -->
  <div class="border-t border-border/40 pt-2">
    <button
      type="button"
      class="flex w-full items-center gap-1.5 text-[12.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
      :aria-expanded="showHistory"
      @click="toggleHistory"
    >
      <History :size="14" />
      <span>{{ $t("repo.history.title") }}</span>
      <ChevronDown :size="14" :class="cn('ml-auto transition-transform', showHistory && 'rotate-180')" />
    </button>
    <div v-if="showHistory" class="mt-2 space-y-0.5">
      <div
        v-if="loadingLog && !logResult"
        class="flex items-center gap-2 px-1 py-1.5 text-[12px] text-muted-foreground"
      >
        <Loader2 :size="13" class="animate-spin" />{{ $t("repo.history.loading") }}
      </div>
      <div
        v-else-if="logResult && !logResult.commits.length"
        class="px-1 py-1.5 text-[12px] text-muted-foreground"
      >
        {{ $t("repo.history.empty") }}
      </div>
      <template v-else>
        <div v-for="cmt in logResult?.commits ?? []" :key="cmt.hash">
          <div class="group/c flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-accent/40">
            <button
              type="button"
              class="mono mt-0.5 shrink-0 text-[11px] text-info/80 outline-none hover:underline focus-visible:underline"
              :title="$t('repo.history.copyHash')"
              :aria-label="$t('repo.history.copyHash')"
              @click="copyHash(cmt.hash)"
            >
              {{ cmt.shortHash }}
            </button>
            <button
              type="button"
              class="min-w-0 flex-1 text-left outline-none"
              :aria-expanded="expandedCommit === cmt.hash"
              :aria-label="$t('repo.history.viewChanges')"
              @click="toggleCommit(cmt.hash)"
            >
              <div class="truncate text-[12.5px] text-foreground group-hover/c:underline" :title="cmt.subject">
                {{ cmt.subject }}
              </div>
              <div class="truncate text-[11px] text-muted-foreground">
                {{ $t("repo.history.by", { author: cmt.authorName }) }} · {{ fromNow(cmt.date) }}
              </div>
            </button>
            <ChevronDown
              :size="13"
              :class="
                cn('mt-1 shrink-0 text-muted-foreground transition-transform', expandedCommit === cmt.hash && 'rotate-180')
              "
            />
          </div>
          <!-- tap-to-expand: the commit's changed files + bounded diff -->
          <div
            v-if="expandedCommit === cmt.hash"
            class="mt-0.5 mb-1 ml-1.5 rounded-md border border-border/50 bg-secondary/20 p-2"
          >
            <div v-if="loadingCommit === cmt.hash" class="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 :size="13" class="animate-spin" />{{ $t("repo.history.loading") }}
            </div>
            <template v-else-if="commitCache[cmt.hash]?.ok">
              <div class="mb-1.5 flex flex-wrap gap-1">
                <span
                  v-for="f in commitCache[cmt.hash].files"
                  :key="f.path"
                  class="mono inline-flex max-w-full items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[11px]"
                >
                  <span class="font-semibold text-muted-foreground">{{ f.status }}</span>
                  <span class="truncate" :title="f.path">{{ f.path }}</span>
                </span>
              </div>
              <pre class="mono max-h-64 overflow-auto rounded bg-background/60 p-2 text-[11px] leading-snug">{{ commitCache[cmt.hash].diff || $t("repo.history.noDiff") }}</pre>
              <p v-if="commitCache[cmt.hash].truncated" class="mt-1 text-[11px] text-muted-foreground">
                {{ $t("repo.history.diffTruncated") }}
              </p>
            </template>
            <div v-else class="text-[12px] text-muted-foreground">
              {{ commitCache[cmt.hash]?.message || $t("repo.history.detailUnavailable") }}
            </div>
          </div>
        </div>
        <button
          v-if="logResult?.hasMore"
          type="button"
          class="mt-1 w-full rounded-md py-1.5 text-[12px] text-muted-foreground outline-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
          :disabled="loadingLog"
          @click="loadMoreLog"
        >
          <Loader2 v-if="loadingLog" :size="13" class="mr-1 inline animate-spin" />{{ $t("repo.history.loadMore") }}
        </button>
      </template>
    </div>
  </div>
</template>
