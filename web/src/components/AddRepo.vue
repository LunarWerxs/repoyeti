<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { FolderGit2, FolderPlus, DownloadCloud, Loader2 } from "@lucide/vue";
import { toast } from "vue-sonner";
import { useStore } from "../store";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const { t } = useI18n();

const open = defineModel<boolean>("open", { required: true });
const store = useStore();

type Mode = "register" | "create" | "clone";
const mode = ref<Mode>("register");
const path = ref(""); // register / create

// clone fields
const cloneUrl = ref("");
const cloneParent = ref("");
const cloneName = ref("");
const cloneIdentity = ref("none"); // "none" sentinel → null on submit

const busy = ref(false);

// Load scan roots when the dialog opens so the clone destination can default to one.
watch(open, (isOpen) => {
  if (isOpen && !store.roots.length) void store.loadRoots();
});
watch(
  () => store.roots,
  (rs) => {
    if (!cloneParent.value && rs.length) cloneParent.value = rs[0]!;
  },
  { immediate: true },
);

const canSubmit = computed(() => {
  if (busy.value) return false;
  if (mode.value === "clone") return cloneUrl.value.trim().length > 0 && cloneParent.value.trim().length > 0;
  return path.value.trim().length > 0;
});

const seg = (active: boolean): string =>
  cn(
    "flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium outline-none transition-all active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring/40",
    active
      ? "bg-card text-foreground shadow-sm"
      : "text-muted-foreground hover:bg-card/50 hover:text-foreground active:bg-card/70",
  );

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  busy.value = true;
  try {
    if (mode.value === "clone") {
      const repo = await store.cloneRepo({
        url: cloneUrl.value.trim(),
        parentPath: cloneParent.value.trim(),
        name: cloneName.value.trim() || undefined,
        identityId: cloneIdentity.value === "none" ? null : cloneIdentity.value,
      });
      toast.success(t("addRepo.toastCloned", { name: repo.name }));
      cloneUrl.value = "";
      cloneName.value = "";
    } else {
      const repo = await store.addRepo(mode.value, path.value.trim());
      toast.success(
        mode.value === "create"
          ? t("addRepo.toastCreated", { name: repo.name })
          : t("addRepo.toastAdded", { name: repo.name }),
      );
      path.value = "";
    }
    open.value = false;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t("addRepo.toastFailed"));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ $t("addRepo.title") }}</DialogTitle>
        <DialogDescription>{{ $t("addRepo.description") }}</DialogDescription>
      </DialogHeader>

      <div class="grid grid-cols-3 gap-1 rounded-lg bg-secondary p-1">
        <button :class="seg(mode === 'register')" :aria-pressed="mode === 'register'" @click="mode = 'register'">
          <FolderGit2 :size="14" /> {{ $t("addRepo.modeRegister") }}
        </button>
        <button :class="seg(mode === 'create')" :aria-pressed="mode === 'create'" @click="mode = 'create'">
          <FolderPlus :size="14" /> {{ $t("addRepo.modeCreate") }}
        </button>
        <button :class="seg(mode === 'clone')" :aria-pressed="mode === 'clone'" @click="mode = 'clone'">
          <DownloadCloud :size="14" /> {{ $t("addRepo.modeClone") }}
        </button>
      </div>

      <!-- register / create: a single path -->
      <template v-if="mode !== 'clone'">
        <p class="text-[12.5px] text-muted-foreground">
          <template v-if="mode === 'register'">{{ $t("addRepo.hintRegister") }}</template>
          <template v-else>{{ $t("addRepo.hintCreateBefore") }}<code class="mono">git init</code>{{ $t("addRepo.hintCreateAfter") }}</template>
        </p>
        <Input
          v-model="path"
          class="mono"
          :placeholder="mode === 'register' ? $t('addRepo.placeholderRegister') : $t('addRepo.placeholderCreate')"
          @keyup.enter="submit"
        />
      </template>

      <!-- clone: url + destination folder + optional name + identity -->
      <template v-else>
        <p class="text-[12.5px] text-muted-foreground">{{ $t("addRepo.hintClone") }}</p>
        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] text-muted-foreground">{{ $t("addRepo.labelUrl") }}</label>
          <Input v-model="cloneUrl" class="mono" :placeholder="$t('addRepo.placeholderUrl')" @keyup.enter="submit" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] text-muted-foreground">{{ $t("addRepo.labelParent") }}</label>
          <Input v-model="cloneParent" class="mono" :placeholder="$t('addRepo.placeholderParent')" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] text-muted-foreground">{{ $t("addRepo.labelName") }}</label>
          <Input v-model="cloneName" class="mono" :placeholder="$t('addRepo.placeholderName')" @keyup.enter="submit" />
        </div>
        <div v-if="store.identities.length" class="flex flex-col gap-1.5">
          <label class="text-[12px] text-muted-foreground">{{ $t("addRepo.labelIdentity") }}</label>
          <Select v-model="cloneIdentity">
            <SelectTrigger class="w-full" :aria-label="$t('addRepo.labelIdentity')"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{{ $t("addRepo.identityNone") }}</SelectItem>
              <SelectItem v-for="i in store.identities" :key="i.id" :value="i.id">{{ i.displayName }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </template>

      <DialogFooter>
        <Button variant="ghost" @click="open = false">{{ $t("addRepo.cancel") }}</Button>
        <Button :disabled="!canSubmit" @click="submit">
          <Loader2 v-if="busy" class="animate-spin" />
          {{ mode === "create" ? $t("addRepo.submitCreate") : mode === "clone" ? $t("addRepo.submitClone") : $t("addRepo.submitAdd") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
