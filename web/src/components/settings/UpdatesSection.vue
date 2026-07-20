<script setup lang="ts">
// General-tab section: app auto-update consents. (Keyboard shortcuts lived here briefly as one
// merged group; they're their own HotkeysSection under Advanced now — updates and accelerators
// never belonged under one header.)
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { useStore } from "../../store";
import SettingsGroup from "@/shell/SettingsGroup.vue";
import SettingsRow from "@/shell/SettingsRow.vue";
import InfoHint from "@/shell/InfoHint.vue";
import { Switch } from "@/components/ui/switch";

const store = useStore();
const { t } = useI18n();

// Two separate consents, deliberately two switches (see src/auto-update.ts):
//   · "Tell me about updates" (on by default) — announce one, install nothing.
//   · "Install them automatically" (opt-in) — apply + restart the daemon unattended.
async function onUpdateNotify(enabled: boolean): Promise<void> {
  try {
    await store.setUpdateNotify(enabled);
  } catch {
    toast.error(t("settings.updateNotifyFailed"));
  }
}
async function onAutoUpdate(enabled: boolean): Promise<void> {
  try {
    await store.setAutoUpdate(enabled);
  } catch {
    toast.error(t("settings.autoUpdateFailed"));
  }
}
</script>

<template>
  <SettingsGroup :label="$t('settings.cardUpdates')">
    <SettingsRow :label="$t('settings.updateNotify')">
      <template #info><InfoHint :text="$t('settings.updateNotifyHint')" /></template>
      <template #control>
        <Switch
          :model-value="store.updateNotify"
          :aria-label="$t('settings.updateNotify')"
          @update:model-value="(v: boolean) => onUpdateNotify(v)"
        />
      </template>
    </SettingsRow>
    <SettingsRow :label="$t('settings.autoUpdate')">
      <template #info><InfoHint :text="$t('settings.autoUpdateHint')" /></template>
      <template #control>
        <Switch
          :model-value="store.autoUpdate"
          :aria-label="$t('settings.autoUpdate')"
          @update:model-value="(v: boolean) => onAutoUpdate(v)"
        />
      </template>
    </SettingsRow>
  </SettingsGroup>
</template>
