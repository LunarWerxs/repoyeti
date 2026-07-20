<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Check, Trash2, LogOut, Loader2, Cloud, ExternalLink, Link2, Copy } from "@lucide/vue";
import { toast } from "vue-sonner";
import { useStore } from "../../store";
import { ApiError } from "../../api";
import SettingsGroup from "@/shell/SettingsGroup.vue";
import SettingsRow from "@/shell/SettingsRow.vue";
import InfoHint from "@/shell/InfoHint.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

/** Whether the parent Settings sheet is open — drives the on-open reset/seed below. */
const props = defineProps<{ open: boolean }>();
const store = useStore();
const { t } = useI18n();

// ── access mode (local ↔ remote) ──────────────────────────────────────────────
const isRemote = computed(() => store.mode === "remote");
const switchingMode = ref(false);
// Set when enabling remote is refused because no Connections owner has claimed this
// daemon yet. Discloses the inline sign-in prompt below the toggle instead of
// bouncing the whole page to OAuth mid-toggle.
const needsOwner = ref(false);
async function setAccessMode(toRemote: boolean): Promise<void> {
  switchingMode.value = true;
  try {
    await store.setMode(toRemote ? "remote" : "local");
    needsOwner.value = false;
  } catch (e) {
    if (e instanceof ApiError && e.code === "NEEDS_OWNER") {
      needsOwner.value = true;
      return;
    }
    toast.error(t("remote.modeFailed"));
  } finally {
    switchingMode.value = false;
  }
}

// ── stable address (named Cloudflare tunnel) ──────────────────────────────────
// By default the remote URL rotates each restart; a named tunnel (stable hostname + connector
// token) gives a permanent address. The token is write-only — the daemon never echoes it back,
// so the field stays blank and an empty submit keeps the saved one.
const tunnelHost = ref("");
const tunnelToken = ref("");
const savingTunnel = ref(false);
/** Self-hosted-relay disclosure (only relevant while on the default address). */
const relaySelfHostOpen = ref(false);
/** Setup guide for a custom domain (linked from the editor — a "hostname + connector token"
 *  pair is not guessable without it). */
const STABLE_ADDRESS_DOCS = "https://github.com/LunarWerxs/RepoYeti/blob/main/docs/STABLE_ADDRESS.md";
/** Guide for running your own relay Worker (the "Use a different relay" path). */
const RELAY_SELFHOST_DOCS = "https://github.com/LunarWerxs/RepoYeti/blob/main/relay/README.md";
async function saveTunnel(): Promise<void> {
  if (savingTunnel.value) return;
  savingTunnel.value = true;
  try {
    const input: { hostname?: string; token?: string } = { hostname: tunnelHost.value.trim() };
    const tok = tunnelToken.value.trim();
    if (tok) input.token = tok; // omit when blank → keep the saved token
    await store.setTunnel(input);
    tunnelToken.value = "";
    customOpen.value = false; // the status line above now shows the saved domain
    toast.success(t("settings.tunnelSaved"));
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t("settings.tunnelSaveFailed"));
  } finally {
    savingTunnel.value = false;
  }
}
// (Removal of a configured custom address goes through the Custom-address switch's inline
// confirm — see removeCustomAddress below. One removal path, not two.)

// ── the stable address (relay-backed by default, custom domain when configured) ──────
// A quick tunnel is handed a NEW hostname every restart, so share links already sent stop
// resolving. The DEFAULT stable address is the hosted relay: one link per daemon that never
// moves and forwards to wherever it currently lives (the daemon side defaults it on — see
// config.ts relayEffective). "Custom address" swaps it for the owner's own domain (a named
// Cloudflare tunnel), at which point the relay steps aside automatically.
const savingRelay = ref(false);
const relayUrlField = ref("");
const copiedRelay = ref(false);

// The Custom-address editor: disclosed by its Switch. Turning the switch OFF while a custom
// address is configured is destructive (it removes the domain and falls back to the default
// address), so it arms an inline confirm instead of firing immediately.
const customOpen = ref(false);
const pendingDisable = ref(false);
const customOn = computed(() => store.tunnelConfig.named || customOpen.value);
function onCustomToggle(v: boolean): void {
  if (v) {
    customOpen.value = true;
    pendingDisable.value = false;
    return;
  }
  if (store.tunnelConfig.named) {
    customOpen.value = true; // keep the editor visible under the confirm
    pendingDisable.value = true;
    return;
  }
  customOpen.value = false;
  pendingDisable.value = false;
}
async function removeCustomAddress(): Promise<void> {
  try {
    await store.setTunnel({ hostname: "", token: "" });
    tunnelHost.value = "";
    tunnelToken.value = "";
    customOpen.value = false;
    pendingDisable.value = false;
    toast.success(t("settings.tunnelForgot"));
  } catch {
    toast.error(t("settings.tunnelSaveFailed"));
  }
}

async function saveRelayUrl(): Promise<void> {
  if (savingRelay.value) return;
  savingRelay.value = true;
  try {
    await store.setRelay({ url: relayUrlField.value.trim() });
    toast.success(t("settings.relaySaved"));
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t("settings.relaySaveFailed"));
  } finally {
    savingRelay.value = false;
  }
}

async function copyRelayUrl(): Promise<void> {
  if (!store.relayUrl) return;
  try {
    await navigator.clipboard.writeText(store.relayUrl);
    copiedRelay.value = true;
    setTimeout(() => (copiedRelay.value = false), 2000);
  } catch {
    toast.error(t("share.copyFailed"));
  }
}

// ── sign out everywhere (rotates the daemon signing key) ──────────────────────
const confirmSignOutAll = ref(false);
async function signOutAll(): Promise<void> {
  if (!confirmSignOutAll.value) {
    confirmSignOutAll.value = true; // inline two-step confirm
    return;
  }
  confirmSignOutAll.value = false;
  try {
    await store.logoutAll();
    toast.success(t("settings.signOutAllDone"));
    // The current device's cookie is now void too — reload so the auth gate re-evaluates.
    window.location.reload();
  } catch {
    toast.error(t("settings.signOutAllFailed"));
  }
}

// Seed the stable-address field from the live config whenever the sheet opens (the token
// stays blank — it's write-only) and reset the transient disclosure/confirm states.
//
// `immediate: true` is required, not cosmetic: the Settings sheet is a Reka DialogRoot, so this
// component isn't MOUNTED until the sheet opens — meaning `open` is already true on creation and a
// plain watcher never sees a false→true edge, so this body never ran. The visible symptom was the
// "Stable address" input rendering EMPTY even with a hostname configured (tunnelHost is a local
// ref that nothing else seeds), which reads as "not set" and invites re-typing it.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      tunnelHost.value = store.tunnelConfig.hostname ?? "";
      // Blank when the daemon is on its default relay: showing the default URL as if the owner had
      // chosen it invites edits to a field that didn't need one. The placeholder names it instead.
      relayUrlField.value =
        store.relayConfig.url && store.relayConfig.url !== store.relayConfig.defaultUrl
          ? store.relayConfig.url
          : "";
      relaySelfHostOpen.value = false;
      copiedRelay.value = false;
      customOpen.value = false;
      pendingDisable.value = false;
      needsOwner.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <!-- (The signed-in Connections account row lives in CloudSyncSection now — one account, one
       place. This section only discloses an inline sign-in prompt when the remote toggle
       actually needs an owner, below.) -->

  <!-- Access (local ↔ remote) ───────────────────────────────────── -->
  <SettingsGroup :label="$t('settings.cardAccess')">
    <SettingsRow :label="$t('settings.accessMode')">
      <template #info><InfoHint :text="isRemote ? $t('remote.modeOnHint') : $t('remote.modeOffHint')" /></template>
      <template #control>
        <Switch
          :model-value="isRemote"
          :disabled="switchingMode"
          :aria-label="$t('settings.accessMode')"
          @update:model-value="(v: boolean) => setAccessMode(v)"
        />
      </template>
    </SettingsRow>

    <!-- Turning remote on needs a claimed Connections owner: disclose the sign-in step
         inline instead of redirecting out from under the toggle. -->
    <div v-if="needsOwner && !isRemote" class="px-3.5 pb-3">
      <div class="flex flex-col gap-2.5 rounded-lg border border-info/30 bg-info/10 p-3">
        <p class="text-[12.5px] leading-snug text-foreground/90">{{ $t("remote.needsOwner") }}</p>
        <!-- New tab, same reasoning as the remote-access modal: signing in navigates away to the
             provider, and doing that in place discards the Settings panel you were in. -->
        <Button as="a" href="/oauth/login" target="_blank" rel="noopener noreferrer" size="sm" class="self-start">
          <Cloud />
          {{ $t("remote.connectCta") }}
          <ExternalLink :size="13" class="opacity-70" />
        </Button>
      </div>
    </div>

    <!-- The rows below only mean anything while remote access is on: the tunnel names the
         remote URL, and "sign out everywhere" revokes remote sessions. Hidden otherwise. -->
    <template v-if="isRemote">
      <!-- THE stable address: relay-backed by default (zero config), the owner's own domain when
           Custom address is on. One status area — never a wall of pre-filled inputs. -->
      <div class="flex flex-col gap-2.5 px-3.5 py-3">
        <div class="flex items-center gap-1.5">
          <span class="text-[12.5px] font-medium text-foreground">{{ $t("settings.tunnelLabel") }}</span>
          <InfoHint :text="$t('settings.stableAddressHint')" />
        </div>
        <!-- custom domain active -->
        <p
          v-if="store.tunnelConfig.named"
          class="flex items-center gap-1.5 text-[12px] text-success"
        >
          <Check :size="13" class="shrink-0" />
          <span class="min-w-0 break-all">{{ $t("settings.tunnelActive", { host: store.tunnelConfig.hostname }) }}</span>
        </p>
        <!-- default (hosted relay) address -->
        <template v-else-if="store.relayConfig.enabled">
          <div v-if="store.relayUrl" class="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-2">
            <Link2 :size="13" class="shrink-0 text-muted-foreground" />
            <span class="mono min-w-0 flex-1 truncate text-[12px] text-foreground/90">{{ store.relayUrl }}</span>
            <Button variant="ghost" size="sm" class="shrink-0" @click="copyRelayUrl">
              <Check v-if="copiedRelay" />
              <Copy v-else />
              {{ copiedRelay ? $t("share.copied") : $t("share.copy") }}
            </Button>
          </div>
          <p v-if="store.relayAnnounced" class="flex items-center gap-1.5 text-[12px] text-success">
            <Check :size="13" class="shrink-0" />
            <span class="min-w-0">{{ $t("settings.relayRegistered") }}</span>
          </p>
          <!-- "On but not registered" is a real state (no tunnel up yet, or the relay is down), and
               it means links minted right now still carry the rotating address. Don't hide it. -->
          <p v-else class="text-[11.5px] leading-snug text-warning">{{ $t("settings.relayPending") }}</p>

          <!-- Which relay forwards for you is a self-hosting detail; the default works, keep it folded. -->
          <button
            type="button"
            class="self-start text-[11.5px] text-muted-foreground underline-offset-2 hover:underline"
            @click="relaySelfHostOpen = !relaySelfHostOpen"
          >
            {{ relaySelfHostOpen ? $t("settings.relayHideAdvanced") : $t("settings.relayShowAdvanced") }}
          </button>
          <div v-if="relaySelfHostOpen" class="flex flex-col gap-2">
            <Input
              v-model="relayUrlField"
              class="mono text-[12.5px]"
              :placeholder="store.relayConfig.defaultUrl"
              :aria-label="$t('settings.relayUrlLabel')"
            />
            <p class="text-[11.5px] leading-snug text-muted-foreground">{{ $t("settings.relayUrlHint") }}</p>
            <Button size="sm" class="self-start" :disabled="savingRelay" @click="saveRelayUrl">
              <Loader2 v-if="savingRelay" class="animate-spin" />
              <Check v-else />
              {{ $t("settings.relaySave") }}
            </Button>
            <!-- The one thing that makes "point at your own" real: how to stand one up. It's a single
                 Cloudflare Worker; the guide is a few paragraphs, not a project. -->
            <a
              :href="RELAY_SELFHOST_DOCS"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-1 self-start text-[11.5px] text-info underline-offset-2 hover:underline"
            >
              {{ $t("settings.relaySelfHostDocs") }}
              <ExternalLink :size="11" class="opacity-70" />
            </a>
          </div>
        </template>
        <!-- relay explicitly disabled in config, no custom domain -->
        <p v-else class="text-[11.5px] leading-snug text-warning">{{ $t("settings.stableAddressOff") }}</p>
      </div>

      <!-- Custom address: your own domain instead of the built-in forwarding address -->
      <div class="flex flex-col gap-2.5 px-3.5 py-3">
        <div class="flex items-center justify-between gap-3">
          <span class="flex items-center gap-1.5">
            <span class="text-[12.5px] font-medium text-foreground">{{ $t("settings.customAddress") }}</span>
            <InfoHint :text="$t('settings.customAddressHint')" />
          </span>
          <Switch
            :model-value="customOn"
            :aria-label="$t('settings.customAddress')"
            @update:model-value="(v: boolean) => onCustomToggle(v)"
          />
        </div>

        <!-- Turning it off removes the configured domain — confirm, don't just do it. -->
        <div v-if="pendingDisable" class="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <p class="text-[12px] leading-snug text-foreground/90">
            {{ $t("settings.customAddressDisableWarn", { host: store.tunnelConfig.hostname }) }}
          </p>
          <div class="flex items-center gap-2">
            <Button variant="destructive" size="sm" @click="removeCustomAddress">
              <Trash2 />
              {{ $t("settings.customAddressRemove") }}
            </Button>
            <Button variant="ghost" size="sm" @click="pendingDisable = false">{{ $t("common.cancel") }}</Button>
          </div>
        </div>

        <!-- Configured + editor closed: the domain shows in the status above; offer the editor. -->
        <button
          v-if="store.tunnelConfig.named && !customOpen"
          type="button"
          class="self-start text-[11.5px] text-muted-foreground underline-offset-2 hover:underline"
          @click="customOpen = true"
        >
          {{ $t("settings.tunnelEditChange") }}
        </button>

        <template v-if="customOpen && !pendingDisable">
          <Input
            v-model="tunnelHost"
            class="mono text-[12.5px]"
            :placeholder="$t('settings.tunnelHostPlaceholder')"
            :aria-label="$t('settings.tunnelHostLabel')"
          />
          <Input
            v-if="!store.tunnelConfig.tokenFromEnv"
            v-model="tunnelToken"
            type="password"
            class="text-[12.5px]"
            :placeholder="store.tunnelConfig.hasToken ? $t('settings.tunnelTokenSaved') : $t('settings.tunnelTokenPlaceholder')"
            :aria-label="$t('settings.tunnelTokenLabel')"
          />
          <p v-else class="text-[11.5px] text-muted-foreground">{{ $t("settings.tunnelTokenEnv") }}</p>
          <Button size="sm" class="self-start" :disabled="savingTunnel" @click="saveTunnel">
            <Loader2 v-if="savingTunnel" class="animate-spin" />
            <Check v-else />
            {{ $t("settings.tunnelSave") }}
          </Button>
          <!-- The part nobody can guess: what a "hostname and connector token" even are. -->
          <a
            :href="STABLE_ADDRESS_DOCS"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1 self-start text-[11.5px] text-info underline-offset-2 hover:underline"
          >
            {{ $t("settings.stableAddressDocs") }}
            <ExternalLink :size="11" class="opacity-70" />
          </a>
        </template>
      </div>

      <!-- sign out everywhere (rotates the signing key → invalidates all devices) -->
      <div v-if="store.authEnforced" class="flex items-center justify-between gap-3 px-3.5 py-3">
        <span class="flex items-center gap-1.5">
          <span class="text-[12.5px] font-medium text-foreground">{{ $t("settings.signOutAll") }}</span>
          <InfoHint :text="$t('settings.signOutAllHint')" />
        </span>
        <Button
          :variant="confirmSignOutAll ? 'destructive' : 'outline'"
          size="sm"
          class="shrink-0"
          @click="signOutAll"
          @blur="confirmSignOutAll = false"
        >
          <LogOut />
          {{ confirmSignOutAll ? $t("settings.signOutAllConfirm") : $t("settings.signOutAll") }}
        </Button>
      </div>
    </template>
  </SettingsGroup>
</template>
