<script setup lang="ts">
// A compact, dependency-free visual summary for the History panel. The backend owns the
// aggregation so this view stays correct even though the commit table itself is paginated.
// Bars show hourly line churn (green additions + red removals); the blue line independently
// scales hourly commit count. Exact values are always available from each keyboard-focusable
// bucket, so the small chart remains useful without turning into a dashboard of axis labels.
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  HistoryActivity,
  HistoryActivityAuthor,
  HistoryActivityBucket,
} from "@/types";

const props = defineProps<{ activity: HistoryActivity | null; loading: boolean }>();
const { t, locale } = useI18n();

const CHART_W = 600;
const CHART_H = 74;
const PLOT_TOP = 8;
const BASE_Y = 64;
const PLOT_H = BASE_Y - PLOT_TOP;

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

const compactFormatter = computed(
  () =>
    new Intl.NumberFormat(locale.value, {
      notation: "compact",
      maximumFractionDigits: 1,
    }),
);
const rateFormatter = computed(
  () =>
    new Intl.NumberFormat(locale.value, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
);

function compactCount(value: number): string {
  return compactFormatter.value.format(safeCount(value));
}

function compactRate(value: number): string {
  const n = safeCount(value);
  if (n === 0) return "0";
  return n >= 1000 ? compactCount(n) : rateFormatter.value.format(n);
}

const totalLines = computed(() => {
  const activity = props.activity;
  return activity ? safeCount(activity.addedLines) + safeCount(activity.removedLines) : 0;
});
const averageLinesPerHour = computed(() => {
  const hours = safeCount(props.activity?.windowHours ?? 0) || 24;
  return totalLines.value / hours;
});

const metrics = computed(() => {
  const activity = props.activity;
  if (!activity) return [];
  return [
    {
      id: "last-hour",
      label: t("repo.history.activityOneHour"),
      value: compactCount(activity.commitsLastHour),
      exact: String(safeCount(activity.commitsLastHour)),
    },
    {
      id: "window",
      label: t("repo.history.activityTwentyFourHours"),
      value: compactCount(activity.commits),
      exact: String(safeCount(activity.commits)),
    },
    {
      id: "contributors",
      label: t("repo.history.activityContributors"),
      value: compactCount(activity.contributors),
      exact: String(safeCount(activity.contributors)),
    },
    {
      id: "lines",
      label: t("repo.history.activityLinesChanged"),
      value: compactCount(totalLines.value),
      exact: String(totalLines.value),
    },
    {
      id: "average",
      label: t("repo.history.activityAveragePerHour"),
      value: compactRate(averageLinesPerHour.value),
      exact: rateFormatter.value.format(averageLinesPerHour.value),
    },
  ];
});

function authorLabel(author: HistoryActivityAuthor): string {
  return author.name.trim() || author.email.trim() || "—";
}

function authorInitials(author: HistoryActivityAuthor): string {
  const words = authorLabel(author)
    .replace(/@.*$/, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "•";
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase(locale.value);
}

function authorSummary(author: HistoryActivityAuthor): string {
  const commits = safeCount(author.commits);
  return t("repo.history.activityAuthorSummary", {
    name: authorLabel(author),
    email: author.email,
    commits: t("repo.history.activityCommitCount", { count: commits }, commits),
    added: safeCount(author.addedLines),
    removed: safeCount(author.removedLines),
  });
}

const sortedAuthors = computed(() =>
  [...(props.activity?.authors ?? [])].sort(
    (a, b) =>
      safeCount(b.commits) - safeCount(a.commits) ||
      safeCount(b.addedLines) +
        safeCount(b.removedLines) -
        safeCount(a.addedLines) -
        safeCount(a.removedLines) ||
      authorLabel(a).localeCompare(authorLabel(b)),
  ),
);
const shownAuthors = computed(() => sortedAuthors.value.slice(0, 5));
const hiddenAuthorCount = computed(() =>
  Math.max(
    0,
    safeCount(props.activity?.contributors ?? 0) - shownAuthors.value.length,
    sortedAuthors.value.length - shownAuthors.value.length,
  ),
);
const hiddenAuthorTitle = computed(() =>
  sortedAuthors.value
    .slice(shownAuthors.value.length)
    .map(authorLabel)
    .join(", "),
);

const buckets = computed(() =>
  [...(props.activity?.buckets ?? [])].sort((a, b) => a.start - b.start),
);

interface RenderBucket {
  bucket: HistoryActivityBucket;
  index: number;
  x: number;
  center: number;
  hitX: number;
  hitWidth: number;
  barWidth: number;
  addedY: number;
  addedHeight: number;
  removedY: number;
  removedHeight: number;
  commitY: number;
}

const renderBuckets = computed<RenderBucket[]>(() => {
  const source = buckets.value;
  if (!source.length) return [];

  const slot = CHART_W / source.length;
  const barWidth = Math.min(18, slot * 0.62);
  const maxChurn = Math.max(
    1,
    ...source.map((bucket) => safeCount(bucket.addedLines) + safeCount(bucket.removedLines)),
  );
  const maxCommits = Math.max(1, ...source.map((bucket) => safeCount(bucket.commits)));

  return source.map((bucket, index) => {
    const added = safeCount(bucket.addedLines);
    const removed = safeCount(bucket.removedLines);
    const churn = added + removed;
    // Square-root scaling keeps one generated-file commit from flattening every normal commit.
    // The split inside each bar remains proportional, while the tooltip carries exact values.
    const totalHeight = churn ? Math.max(3, Math.sqrt(churn / maxChurn) * PLOT_H) : 0;
    let addedHeight = churn ? totalHeight * (added / churn) : 0;
    let removedHeight = totalHeight - addedHeight;
    if (added > 0 && removed > 0) {
      if (addedHeight < 1) {
        addedHeight = 1;
        removedHeight = totalHeight - 1;
      } else if (removedHeight < 1) {
        removedHeight = 1;
        addedHeight = totalHeight - 1;
      }
    }
    const center = slot * index + slot / 2;

    return {
      bucket,
      index,
      x: center - barWidth / 2,
      center,
      hitX: slot * index + 1,
      hitWidth: Math.max(1, slot - 2),
      barWidth,
      addedY: BASE_Y - addedHeight,
      addedHeight,
      removedY: BASE_Y - addedHeight - removedHeight,
      removedHeight,
      commitY: BASE_Y - (safeCount(bucket.commits) / maxCommits) * PLOT_H,
    };
  });
});

const commitLinePoints = computed(() =>
  renderBuckets.value.map((item) => `${item.center},${item.commitY}`).join(" "),
);
const hasCommitLine = computed(() =>
  renderBuckets.value.some((item) => safeCount(item.bucket.commits) > 0),
);

const dateTimeFormatter = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
);
const timeFormatter = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      hour: "numeric",
      minute: "2-digit",
    }),
);

function bucketEnd(index: number): number {
  const bucket = buckets.value[index];
  if (!bucket) return 0;
  const next = buckets.value[index + 1]?.start ?? bucket.start + 60 * 60 * 1000;
  const until = props.activity?.until ?? next;
  return Math.max(bucket.start, Math.min(next, until));
}

function bucketTime(index: number): string {
  const bucket = buckets.value[index];
  if (!bucket || !Number.isFinite(bucket.start)) return "—";
  return `${dateTimeFormatter.value.format(new Date(bucket.start))} – ${timeFormatter.value.format(
    new Date(bucketEnd(index)),
  )}`;
}

function bucketSummary(item: RenderBucket): string {
  const commits = safeCount(item.bucket.commits);
  const files = safeCount(item.bucket.filesChanged);
  return t("repo.history.activityBucketSummary", {
    time: bucketTime(item.index),
    commits: t("repo.history.activityCommitCount", { count: commits }, commits),
    files: t("repo.history.activityFileCount", { count: files }, files),
    added: safeCount(item.bucket.addedLines),
    removed: safeCount(item.bucket.removedLines),
  });
}

const activeIndex = ref<number | null>(null);
const activeBucket = computed(() =>
  activeIndex.value == null ? null : (renderBuckets.value[activeIndex.value] ?? null),
);
const tooltipLeft = computed(() => {
  const item = activeBucket.value;
  if (!item) return "50%";
  const percent = (item.center / CHART_W) * 100;
  return `${Math.min(82, Math.max(18, percent))}%`;
});

function showBucket(index: number): void {
  activeIndex.value = index;
}

function hideBucket(index: number): void {
  if (activeIndex.value === index) activeIndex.value = null;
}

function toggleBucket(index: number): void {
  activeIndex.value = activeIndex.value === index ? null : index;
}
</script>

<template>
  <section
    class="relative"
    data-testid="history-activity"
    :data-state="loading && !activity ? 'loading' : !activity ? 'empty' : !activity.ok ? 'error' : activity.commits ? 'ready' : 'empty'"
    :aria-busy="loading"
  >
    <!-- Initial load mirrors the final geometry, avoiding a jump when the data arrives. -->
    <div v-if="loading && !activity" role="status" class="space-y-1.5">
      <span class="sr-only">{{ $t("repo.history.activityLoading") }}</span>
      <div class="grid grid-cols-5 gap-px overflow-hidden rounded-md border border-border/50 bg-border/40">
        <div v-for="n in 5" :key="n" class="bg-background/90 px-2 py-1.5">
          <div class="mx-auto h-4 w-8 animate-pulse rounded bg-muted" />
          <div class="mx-auto mt-1 h-2 w-12 animate-pulse rounded bg-muted/70" />
        </div>
      </div>
      <div class="h-[94px] animate-pulse rounded-md border border-border/40 bg-muted/30" />
    </div>

    <div
      v-else-if="!activity"
      role="status"
      class="flex min-h-16 items-center justify-center rounded-md border border-dashed border-border/60 px-3 text-[11.5px] text-muted-foreground"
    >
      {{ $t("repo.history.activityEmpty") }}
    </div>

    <div
      v-else-if="!activity.ok"
      role="alert"
      class="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive"
      :title="activity.message"
    >
      {{ activity.message || $t("repo.history.activityError") }}
    </div>

    <div v-else class="space-y-1.5">
      <!-- Five glanceable answers, intentionally noun-light: the labels are short enough to
           survive the narrow repo-card layout while their title retains the exact value. -->
      <div class="grid grid-cols-5 gap-px overflow-hidden rounded-md border border-border/50 bg-border/40">
        <div
          v-for="metric in metrics"
          :key="metric.id"
          class="min-w-0 bg-background/90 px-1.5 py-1.5 text-center"
          :data-activity-kpi="metric.id"
          :title="metric.exact"
        >
          <div class="mono activity-kpi-value truncate text-[13px] font-semibold leading-none tabular-nums text-foreground">
            {{ metric.value }}
          </div>
          <div class="mt-1 truncate text-[9px] font-medium leading-none tracking-wide uppercase text-muted-foreground/70">
            {{ metric.label }}
          </div>
        </div>
      </div>

      <!-- Commit counts by person: identity, contribution count, and exact churn in one hover.
           The cap keeps a many-author repository from turning the compact summary into a roster. -->
      <div
        v-if="shownAuthors.length"
        class="flex min-w-0 items-center gap-1 overflow-hidden text-[10px]"
        data-testid="history-activity-authors"
      >
        <span class="mr-0.5 shrink-0 text-muted-foreground/65">{{ $t("repo.history.activityTopAuthors") }}</span>
        <span
          v-for="author in shownAuthors"
          :key="`${author.email}\u0000${author.name}`"
          class="inline-flex min-w-0 shrink items-center gap-1 rounded-full border border-border/50 bg-secondary/45 py-0.5 pl-0.5 pr-1.5 text-muted-foreground"
          :title="authorSummary(author)"
          data-activity-author
        >
          <span
            class="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[8px] font-semibold text-primary"
            aria-hidden="true"
          >
            {{ authorInitials(author) }}
          </span>
          <span class="max-w-24 truncate text-foreground/80">{{ authorLabel(author) }}</span>
          <span class="mono shrink-0 tabular-nums text-info/80">{{ safeCount(author.commits) }}</span>
        </span>
        <span
          v-if="hiddenAuthorCount"
          class="mono shrink-0 rounded-full border border-border/50 px-1.5 py-0.5 text-muted-foreground"
          :title="hiddenAuthorTitle"
        >
          +{{ hiddenAuthorCount }}
        </span>
      </div>

      <div class="relative overflow-visible rounded-md border border-border/50 bg-secondary/15 px-1.5 pb-1 pt-1">
        <div class="flex h-4 items-center gap-2 px-0.5 text-[9px] leading-none text-muted-foreground/65">
          <span class="font-medium text-muted-foreground">{{ $t("repo.history.activityChartTitle") }}</span>
          <span class="inline-flex items-center gap-1">
            <i class="block size-1.5 rounded-sm bg-success" aria-hidden="true" />
            {{ $t("repo.history.activityAdded") }}
          </span>
          <span class="inline-flex items-center gap-1">
            <i class="block size-1.5 rounded-sm bg-destructive" aria-hidden="true" />
            {{ $t("repo.history.activityRemoved") }}
          </span>
          <span class="inline-flex items-center gap-1">
            <i class="block h-px w-2 bg-info" aria-hidden="true" />
            {{ $t("repo.history.activityCommitsLegend") }}
          </span>
          <span
            v-if="activity.truncated"
            class="ml-auto inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-warning/10 font-semibold text-warning"
            :title="$t('repo.history.activityTruncated')"
            :aria-label="$t('repo.history.activityTruncated')"
          >
            <span aria-hidden="true">!</span>
            <span class="sr-only">{{ $t("repo.history.activityTruncated") }}</span>
          </span>
          <span v-if="loading" :class="activity.truncated ? '' : 'ml-auto'" class="inline-flex items-center gap-1 text-info">
            <i class="block size-1.5 animate-pulse rounded-full bg-info" aria-hidden="true" />
            <span class="sr-only">{{ $t("repo.history.activityLoading") }}</span>
          </span>
        </div>

        <div
          v-if="!activity.commits"
          role="status"
          class="flex h-[74px] items-center justify-center text-[11px] text-muted-foreground"
        >
          {{ $t("repo.history.activityEmpty") }}
        </div>

        <svg
          v-else
          class="block h-[74px] w-full overflow-visible"
          :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
          preserveAspectRatio="none"
          role="group"
          :aria-label="$t('repo.history.activityChartLabel', { hours: activity.windowHours })"
          data-testid="history-activity-chart"
        >
          <line
            x1="0"
            :x2="CHART_W"
            :y1="PLOT_TOP + PLOT_H / 2"
            :y2="PLOT_TOP + PLOT_H / 2"
            stroke="var(--border)"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
            opacity="0.45"
          />
          <line
            x1="0"
            :x2="CHART_W"
            :y1="BASE_Y"
            :y2="BASE_Y"
            stroke="var(--border)"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />

          <g
            v-for="item in renderBuckets"
            :key="item.bucket.start"
            class="activity-bucket outline-none"
            role="button"
            tabindex="0"
            :aria-label="bucketSummary(item)"
            :data-activity-bucket="item.index"
            @mouseenter="showBucket(item.index)"
            @mouseleave="hideBucket(item.index)"
            @focus="showBucket(item.index)"
            @blur="hideBucket(item.index)"
            @click="toggleBucket(item.index)"
            @keydown.enter.prevent="toggleBucket(item.index)"
            @keydown.space.prevent="toggleBucket(item.index)"
            @keydown.escape.prevent="hideBucket(item.index)"
          >
            <rect
              v-if="item.addedHeight"
              :x="item.x"
              :y="item.addedY"
              :width="item.barWidth"
              :height="item.addedHeight"
              rx="1.25"
              fill="var(--success)"
              opacity="0.82"
              data-series="added"
            />
            <rect
              v-if="item.removedHeight"
              :x="item.x"
              :y="item.removedY"
              :width="item.barWidth"
              :height="item.removedHeight"
              rx="1.25"
              fill="var(--destructive)"
              opacity="0.82"
              data-series="removed"
            />
            <!-- Transparent full-height target: even a zero-change hour can be focused to learn
                 that it contained a metadata-only/merge commit. -->
            <rect
              class="activity-hit"
              :x="item.hitX"
              y="1"
              :width="item.hitWidth"
              :height="CHART_H - 2"
              rx="2"
              fill="transparent"
              stroke="transparent"
              vector-effect="non-scaling-stroke"
            />
          </g>

          <polyline
            v-if="hasCommitLine"
            :points="commitLinePoints"
            fill="none"
            stroke="var(--info)"
            stroke-width="1.5"
            stroke-linejoin="round"
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
            opacity="0.9"
            pointer-events="none"
            data-series="commits"
          />
          <circle
            v-for="item in hasCommitLine ? renderBuckets : []"
            :key="`commit-${item.bucket.start}`"
            :cx="item.center"
            :cy="item.commitY"
            r="1.7"
            fill="var(--info)"
            stroke="var(--background)"
            stroke-width="0.8"
            vector-effect="non-scaling-stroke"
            opacity="0.95"
            pointer-events="none"
            aria-hidden="true"
          />
        </svg>

        <div
          v-if="activeBucket"
          role="tooltip"
          class="pointer-events-none absolute top-6 z-10 max-w-64 -translate-x-1/2 rounded-md border border-border bg-popover/95 px-2 py-1.5 text-[10.5px] leading-snug text-popover-foreground shadow-lg backdrop-blur"
          :style="{ left: tooltipLeft }"
          data-testid="history-activity-tooltip"
        >
          {{ bucketSummary(activeBucket) }}
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.activity-bucket:focus-visible .activity-hit {
  stroke: var(--ring);
  stroke-width: 1.5;
}

@media (prefers-reduced-motion: reduce) {
  .animate-pulse {
    animation: none;
  }
}
</style>
