<script setup lang="ts">
// "Open with…" default external editor picker. The file viewer's Open-with button launches this
// editor when the owner doesn't pick a specific one from its dropdown. Editors are launched on the
// daemon's machine, so this is a local-only convenience — but the *preference* is a normal owner
// setting (persisted + synced over `settings_changed`), so it's shown regardless of access mode.
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { useStore } from "../../store";
import type { EditorInfo } from "../../api";
import SettingsGroup from "@/shell/SettingsGroup.vue";
import SettingsRow from "@/shell/SettingsRow.vue";
import InfoHint from "@/shell/InfoHint.vue";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const store = useStore();
const { t } = useI18n();

// Load the detected-editor catalogue when Settings mounts (lazy; no-ops after the first success).
onMounted(() => void store.loadEditors());

// <Select> is string-valued and reka-ui rejects an empty-string item value, so AUTO is the
// non-empty sentinel for "auto-pick the first installed editor" (stored as a null preference
// on the daemon — the store/API layer still uses "" for "clear").
const AUTO = "__auto__";
const editorChoice = computed<string>({
  get: () => store.defaultEditor ?? AUTO,
  set: (v: string) => void onPick(v === AUTO ? "" : v),
});

async function onPick(id: string): Promise<void> {
  try {
    await store.setDefaultEditor(id);
  } catch {
    toast.error(t("settings.editorDefaultFailed"));
  }
}

/** Menu label — real editors show their name; uninstalled ones are annotated so the owner knows
 *  the button will fall back to the first installed editor. */
function editorLabel(e: EditorInfo): string {
  return e.available ? e.label : t("settings.editorNotInstalled", { name: e.label });
}

/**
 * Only editors actually installed on this machine — the catalogue is every editor RepoYeti knows
 * how to launch, which is a much longer list than anyone has installed, and picking one of those
 * did nothing but fall back.
 *
 * The exception: an editor that IS the current selection stays listed even when it looks
 * unavailable. Otherwise a choice made on another machine (settings sync) or one whose detection
 * momentarily fails would vanish from its own dropdown, which reads as the setting silently
 * resetting itself.
 */
const editorOptions = computed<EditorInfo[]>(() =>
  store.editorsCatalog.filter((e) => e.available || e.id === store.defaultEditor),
);
</script>

<template>
  <SettingsGroup :label="$t('settings.cardEditor')">
    <SettingsRow :label="$t('settings.editorDefault')">
      <template #info><InfoHint :text="$t('settings.editorHint')" /></template>
      <template #control>
        <Select v-model="editorChoice">
          <SelectTrigger class="w-full max-w-36" :aria-label="$t('settings.editorDefault')"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="AUTO">{{ $t("settings.editorAuto") }}</SelectItem>
            <SelectItem
              v-for="e in editorOptions"
              :key="e.id"
              :value="e.id"
              :disabled="!e.available"
            >
              {{ editorLabel(e) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </template>
    </SettingsRow>
  </SettingsGroup>
</template>
