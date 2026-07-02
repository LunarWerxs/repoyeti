<script setup lang="ts">
import { watch } from "vue";
import { FolderSearch, FolderGit2, Loader2, X, Settings as SettingsIcon } from "@lucide/vue";
import { useStore } from "../store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ openSettings: [] }>();
const store = useStore();

// Load the configured scan folders when the modal opens — but NEVER auto-scan (the whole point
// of the Start button). The done-summary is left intact across opens so the "View" action on the
// "new projects found" toast can reopen the modal and still show what the last scan found.
watch(open, (isOpen) => {
  if (isOpen && !store.roots.length) void store.loadRoots();
});

function openSettings(): void {
  open.value = false;
  emit("openSettings");
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ $t("scan.title") }}</DialogTitle>
        <DialogDescription>{{ $t("scan.description") }}</DialogDescription>
      </DialogHeader>

      <!-- configured folders (managed in Settings) -->
      <div class="flex flex-col gap-1.5">
        <div class="text-[12px] font-medium text-muted-foreground">{{ $t("scan.foldersHeading") }}</div>
        <template v-if="store.roots.length">
          <ul class="flex flex-col gap-1">
            <li
              v-for="r in store.roots"
              :key="r"
              class="mono flex items-center gap-2 rounded-md border border-border/60 bg-secondary/40 px-2.5 py-1.5 text-[12.5px]"
            >
              <FolderGit2 :size="14" class="shrink-0 text-muted-foreground" />
              <span class="truncate">{{ r }}</span>
            </li>
          </ul>
          <p class="text-[11.5px] text-muted-foreground">{{ $t("scan.manageHint") }}</p>
        </template>
        <div v-else class="flex flex-col items-start gap-2 rounded-md border border-dashed border-border px-3 py-3">
          <p class="text-[12.5px] text-muted-foreground">{{ $t("scan.noFolders") }}</p>
          <Button variant="secondary" size="sm" @click="openSettings">
            <SettingsIcon /> {{ $t("scan.openSettings") }}
          </Button>
        </div>
      </div>

      <!-- live status: scanning (with a Stop X) → or the last run's summary -->
      <div
        v-if="store.scanning"
        class="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-secondary/40 px-3 py-2"
      >
        <div class="flex min-w-0 items-center gap-2 text-[13px]">
          <Loader2 :size="15" class="shrink-0 animate-spin text-info" />
          <span>{{ $t("scan.scanning") }}</span>
          <span class="truncate text-muted-foreground">{{ $t("scan.foundCount", { count: store.scanFound }) }}</span>
        </div>
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          :aria-label="$t('scan.stop')"
          @click="store.cancelScan()"
        >
          <X :size="15" />
        </button>
      </div>
      <div
        v-else-if="store.scanDone"
        class="rounded-md border border-border/60 bg-secondary/40 px-3 py-2 text-[13px]"
      >
        <template v-if="store.scanFound > 0">
          {{ $t("scan.doneFound", { count: store.scanFound }, store.scanFound) }}<span
            v-if="store.scanNew > 0"
            class="text-info"
          > · {{ $t("scan.doneNew", { count: store.scanNew }) }}</span>
        </template>
        <span v-else class="text-muted-foreground">{{ $t("scan.doneNone") }}</span>
        <span v-if="store.lastScanCancelled" class="text-muted-foreground"> · {{ $t("scan.stopped") }}</span>
      </div>

      <DialogFooter>
        <Button variant="ghost" @click="open = false">{{ $t("scan.close") }}</Button>
        <Button v-if="!store.scanning" :disabled="!store.roots.length" @click="store.startScan()">
          <FolderSearch />
          {{ store.scanDone ? $t("scan.again") : $t("scan.start") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
