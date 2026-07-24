<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { useStore } from "../../store";
import { changesViewSize } from "@/lib/changes-view";
import { defaultCommitAction } from "@/lib/commit-default";
import {
  historyActivityEnabled,
  historyChangesDisplay,
  historyGraphEnabled,
} from "@/lib/history-appearance";
import { historyFilesView } from "@/lib/history-view";
import { useTheme } from "@/lib/theme";
import { useTooltipConfig } from "@/lib/tooltip-config";
import SettingsGroup from "@/shell/SettingsGroup.vue";
import SettingsRow from "@/shell/SettingsRow.vue";
import InfoHint from "@/shell/InfoHint.vue";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const store = useStore();
const { t } = useI18n();

// Shared kit light/dark/system theme — writes to the same store App.vue reads.
const { mode: theme } = useTheme();

// Kit-wide tooltip kill-switch (localStorage, like theme). The root TooltipProvider reads
// this flag; InfoHints opt out and stay on (see kit lib/tooltip-config.ts + InfoHint.vue).
const { enabled: tooltipsEnabled } = useTooltipConfig();

// Toggle the per-file/per-repo diff statistics (server setting; rolls back + toasts on fail).
async function onDiffStats(enabled: boolean): Promise<void> {
  try {
    await store.setDiffStats(enabled);
  } catch {
    toast.error(t("settings.diffStatsFailed"));
  }
}

// (The large-file patch THRESHOLD moved to Advanced → Diffs — a byte-size tuning knob, not an
// appearance choice. The user-facing switches stay here.)

// "Always side-by-side" is the user-facing inverse of the server's compact-patch flag:
// ON → never use the compact patch (diffPatchEnabled = false).
async function onAlwaysSideBySide(always: boolean): Promise<void> {
  try {
    await store.setDiffPatchEnabled(!always);
  } catch {
    toast.error(t("settings.diffPatchAlwaysFailed"));
  }
}

// Toggle "Portable window" (server setting). Turning it ON also opens one right away, so the
// owner sees the effect immediately instead of only on the next launch.
async function onPortableMode(enabled: boolean): Promise<void> {
  try {
    await store.setPortableMode(enabled);
  } catch {
    toast.error(t("settings.portableWindowFailed"));
    return;
  }
  if (!enabled) return;
  // The setting is already persisted; the immediate open is best-effort on top of it,
  // so a transport failure here (daemon mid-restart, expired session) must surface a
  // toast too, not become an unhandled rejection.
  try {
    const r = await store.openPortableWindow();
    if (r.ok) toast.success(t("settings.portableWindowOpened"));
    else toast.error(t("settings.portableWindowNoBrowser"));
  } catch {
    toast.error(t("settings.portableWindowFailed"));
  }
}

// Toggle "Hide tray icon" (server setting; rolls back + toasts on fail).
async function onHideTrayIcon(enabled: boolean): Promise<void> {
  try {
    await store.setHideTrayIcon(enabled);
  } catch {
    toast.error(t("settings.hideTrayIconFailed"));
  }
}
</script>

<template>
  <!-- Appearance ───────────────────────────────────────────────── -->
  <SettingsGroup :label="$t('settings.cardAppearance')">
    <SettingsRow :label="$t('settings.theme')">
      <template #control>
        <Select v-model="theme">
          <SelectTrigger class="w-full max-w-36" :aria-label="$t('settings.theme')"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="light">{{ $t("settings.themeLight") }}</SelectItem>
            <SelectItem value="dark">{{ $t("settings.themeDark") }}</SelectItem>
            <SelectItem value="system">{{ $t("settings.themeSystem") }}</SelectItem>
          </SelectContent>
        </Select>
      </template>
    </SettingsRow>
    <SettingsRow :label="$t('settings.defaultCommitAction')">
      <template #info><InfoHint :text="$t('settings.defaultCommitActionHint')" /></template>
      <template #control>
        <Select v-model="defaultCommitAction">
          <SelectTrigger class="w-full max-w-44" :aria-label="$t('settings.defaultCommitAction')"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="commit">{{ $t("repo.commit.commit") }}</SelectItem>
            <SelectItem value="sync">{{ $t("repo.commit.commitSync") }}</SelectItem>
          </SelectContent>
        </Select>
      </template>
    </SettingsRow>
    <SettingsRow :label="$t('settings.showTooltips')">
      <template #info><InfoHint :text="$t('settings.showTooltipsHint')" /></template>
      <template #control>
        <Switch v-model="tooltipsEnabled" :aria-label="$t('settings.showTooltips')" />
      </template>
    </SettingsRow>
    <SettingsRow :label="$t('settings.historyActivity')">
      <template #info><InfoHint :text="$t('settings.historyActivityHint')" /></template>
      <template #control>
        <Switch v-model="historyActivityEnabled" :aria-label="$t('settings.historyActivity')" />
      </template>
    </SettingsRow>
    <SettingsRow :label="$t('settings.historyGraph')">
      <template #info><InfoHint :text="$t('settings.historyGraphHint')" /></template>
      <template #control>
        <Switch v-model="historyGraphEnabled" :aria-label="$t('settings.historyGraph')" />
      </template>
    </SettingsRow>
    <SettingsRow :label="$t('settings.historyChangesDisplay')">
      <template #info><InfoHint :text="$t('settings.historyChangesDisplayHint')" /></template>
      <template #control>
        <Select v-model="historyChangesDisplay">
          <SelectTrigger class="w-full max-w-36" :aria-label="$t('settings.historyChangesDisplay')">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="numbers">{{ $t("settings.historyChangesNumbers") }}</SelectItem>
            <SelectItem value="bars">{{ $t("settings.historyChangesBars") }}</SelectItem>
          </SelectContent>
        </Select>
      </template>
    </SettingsRow>
    <!-- History detail: changed files as a nested folder tree (default) or a flat path list.
         Client-side view preference (localStorage) — see @/lib/history-view. -->
    <SettingsRow :label="$t('settings.historyFilesTree')">
      <template #info><InfoHint :text="$t('settings.historyFilesTreeHint')" /></template>
      <template #control>
        <Switch
          :model-value="historyFilesView === 'tree'"
          :aria-label="$t('settings.historyFilesTree')"
          @update:model-value="(v: boolean) => (historyFilesView = v ? 'tree' : 'list')"
        />
      </template>
    </SettingsRow>
    <SettingsRow :label="$t('settings.portableWindow')">
      <template #info><InfoHint :text="$t('settings.portableWindowHint')" /></template>
      <template #control>
        <Switch
          :model-value="store.portableMode"
          :aria-label="$t('settings.portableWindow')"
          @update:model-value="(v: boolean) => onPortableMode(v)"
        />
      </template>
    </SettingsRow>
    <SettingsRow :label="$t('settings.hideTrayIcon')">
      <template #info><InfoHint :text="$t('settings.hideTrayIconHint')" /></template>
      <template #control>
        <Switch
          :model-value="store.hideTrayIcon"
          :aria-label="$t('settings.hideTrayIcon')"
          @update:model-value="(v: boolean) => onHideTrayIcon(v)"
        />
      </template>
    </SettingsRow>
    <SettingsRow :label="$t('settings.changesHeight')">
      <template #info><InfoHint :text="$t('settings.changesHeightHint')" /></template>
      <template #control>
        <Select v-model="changesViewSize">
          <SelectTrigger class="w-full max-w-36" :aria-label="$t('settings.changesHeight')"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="small">{{ $t("settings.heightSmall") }}</SelectItem>
            <SelectItem value="medium">{{ $t("settings.heightMedium") }}</SelectItem>
            <SelectItem value="tall">{{ $t("settings.heightTall") }}</SelectItem>
          </SelectContent>
        </Select>
      </template>
    </SettingsRow>
    <!-- Diff display rows live in this same group — they're every bit "how things look",
         and a separate two-row "Diffs" header was one lone-header section too many. -->
    <SettingsRow :label="$t('settings.diffStats')">
      <template #info><InfoHint :text="$t('settings.diffStatsHint')" /></template>
      <template #control>
        <Switch
          :model-value="store.diffStatsEnabled"
          :aria-label="$t('settings.diffStats')"
          @update:model-value="(v: boolean) => onDiffStats(v)"
        />
      </template>
    </SettingsRow>
    <SettingsRow :label="$t('settings.diffPatchAlways')">
      <template #info><InfoHint :text="$t('settings.diffPatchAlwaysHint')" /></template>
      <template #control>
        <Switch
          :model-value="!store.diffPatchEnabled"
          :aria-label="$t('settings.diffPatchAlways')"
          @update:model-value="(v: boolean) => onAlwaysSideBySide(v)"
        />
      </template>
    </SettingsRow>
  </SettingsGroup>
</template>
