<script setup lang="ts">
// Renders an added/removed delta as a green "+adds" / red "−dels" pair. Shared by the
// changed-files tree (both lines and chars) and the repo-card header (lines only, with the
// character breakdown carried in a surrounding tooltip). Numbers only — no translatable
// text — so it stays i18n-clean; labels live in the caller's tooltip/title. Tolerates a
// null/undefined stat (renders nothing) so callers can bind possibly-absent stats directly.
//
// In "both" mode the two pairs used to be told apart only by a `·` and a slightly lower
// opacity, which made "+12 −3 · +410 −96" read as one run of four unrelated numbers. Each pair
// now carries a tiny leading glyph instead: ≡ for lines, A for characters.
import { AlignLeft, Type } from "@lucide/vue";
import type { DiffStat } from "@/types";
import { fmtCount } from "@/lib/diffstat";

withDefaults(defineProps<{ stat?: DiffStat | null; show?: "lines" | "chars" | "both" }>(), {
  stat: null,
  show: "both",
});
</script>

<template>
  <span
    v-if="stat"
    class="mono inline-flex shrink-0 items-center gap-1 text-[11px] leading-none tabular-nums"
  >
    <template v-if="show !== 'chars'">
      <!-- the glyph only earns its space when both pairs are present -->
      <AlignLeft v-if="show === 'both'" :size="9" class="shrink-0 text-muted-foreground/50" />
      <span class="text-success">+{{ fmtCount(stat.addedLines) }}</span>
      <span class="text-destructive">−{{ fmtCount(stat.removedLines) }}</span>
    </template>
    <template v-if="show !== 'lines'">
      <Type v-if="show === 'both'" :size="9" class="ml-0.5 shrink-0 text-muted-foreground/50" />
      <span class="text-success/70">+{{ fmtCount(stat.addedChars) }}</span>
      <span class="text-destructive/70">−{{ fmtCount(stat.removedChars) }}</span>
    </template>
  </span>
</template>
