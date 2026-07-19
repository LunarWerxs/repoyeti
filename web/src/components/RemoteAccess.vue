<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Cloud, CloudOff, Copy, Check, ExternalLink, Loader2, Laptop, QrCode, Share2 } from "@lucide/vue";
import { toast } from "vue-sonner";
import { useStore } from "../store";
import { ApiError } from "../api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const open = defineModel<boolean>("open", { required: true });
const store = useStore();
const { t } = useI18n();

const isRemote = computed(() => store.mode === "remote");
const switching = ref(false);
const qrSvg = ref("");
const copied = ref(false);
// The QR starts hidden and is revealed by the button next to the URL. Reset on every open so it
// doesn't reappear expanded from a previous session.
const showQr = ref(false);

const emit = defineEmits<{ shareLinks: [] }>();
/** Hand off to Settings → Access, where share links are actually created. */
function openShareLinks(): void {
  open.value = false;
  emit("shareLinks");
}

// Lazily loaded — qrcode is a ~0.5-1MB lib only needed once the modal is open
// and a tunnel URL exists, so it's kept out of the initial bundle.
let qrcodeModule: typeof import("qrcode") | undefined;
async function loadQrcode(): Promise<typeof import("qrcode")> {
  qrcodeModule ??= (await import("qrcode")).default;
  return qrcodeModule;
}

// (Re)render the QR whenever the dialog opens or the tunnel URL changes. Forced
// dark-on-white so it scans regardless of the app theme.
watch(
  [open, () => store.tunnelUrl],
  async ([isOpen, url]) => {
    if (!isOpen || !url) {
      qrSvg.value = "";
      return;
    }
    try {
      const QRCode = await loadQrcode();
      qrSvg.value = await QRCode.toString(url, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#0b0b0f", light: "#ffffff" },
      });
    } catch {
      qrSvg.value = "";
    }
  },
  { immediate: true },
);

// Set when enabling remote is refused because no Connections owner has claimed this
// daemon yet. Discloses the inline sign-in prompt under the toggle instead of
// redirecting the page out from under the dialog.
const needsOwner = ref(false);
watch(open, (isOpen) => {
  if (isOpen) {
    needsOwner.value = false;
    showQr.value = false;
  }
});

async function setMode(toRemote: boolean): Promise<void> {
  switching.value = true;
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
    switching.value = false;
  }
}

async function setRemoteEditing(v: boolean): Promise<void> {
  try {
    await store.setRemoteEditing(v);
  } catch {
    toast.error(t("remote.editFailed"));
  }
}

async function copyLink(): Promise<void> {
  if (!store.tunnelUrl) return;
  try {
    await navigator.clipboard.writeText(store.tunnelUrl);
    copied.value = true;
    toast.success(t("remote.copied"));
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    toast.error(t("remote.copyFailed"));
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Cloud v-if="isRemote" :size="17" class="text-info" />
          <CloudOff v-else :size="17" class="text-muted-foreground" />
          {{ $t("remote.title") }}
        </DialogTitle>
        <DialogDescription>{{ $t("remote.description") }}</DialogDescription>
      </DialogHeader>

      <!-- mode toggle -->
      <label
        class="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2.5"
      >
        <span class="flex flex-col gap-0.5">
          <span class="text-[13px] font-medium text-foreground">{{ $t("remote.modeLabel") }}</span>
          <span class="text-[12px] text-muted-foreground">
            {{ isRemote ? $t("remote.modeOnHint") : $t("remote.modeOffHint") }}
          </span>
        </span>
        <Loader2 v-if="switching" :size="16" class="animate-spin text-muted-foreground" />
        <Switch
          v-else
          :model-value="isRemote"
          :aria-label="$t('remote.modeLabel')"
          @update:model-value="(v: boolean) => setMode(v)"
        />
      </label>

      <!-- Turning remote on needs a claimed Connections owner: disclose the sign-in step
           inline instead of redirecting out from under the toggle. -->
      <div
        v-if="needsOwner && !isRemote"
        class="flex flex-col gap-2.5 rounded-md border border-info/30 bg-info/10 p-3"
      >
        <p class="text-[12.5px] leading-snug text-foreground/90">{{ $t("remote.needsOwner") }}</p>
        <!-- New tab: the sign-in round-trip leaves the provider's site in control of the page,
             and doing that in place throws away whatever the owner had open here. The dashboard
             re-checks auth when the window regains focus (see AppShell), so coming back from the
             other tab lands on a signed-in view without a manual reload. -->
        <Button as="a" href="/oauth/login" target="_blank" rel="noopener noreferrer" size="sm" class="self-start">
          <Cloud />
          {{ $t("remote.connectCta") }}
          <ExternalLink :size="13" class="opacity-70" />
        </Button>
      </div>

      <!-- editing-over-remote policy — only meaningful while remote access is on -->
      <label
        v-if="isRemote"
        class="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2.5"
      >
        <span class="flex flex-col gap-0.5">
          <span class="text-[13px] font-medium text-foreground">{{ $t("remote.editLabel") }}</span>
          <span class="text-[12px] text-muted-foreground">{{ $t("remote.editHint") }}</span>
        </span>
        <Switch
          :model-value="store.remoteEditing"
          :aria-label="$t('remote.editLabel')"
          @update:model-value="(v: boolean) => setRemoteEditing(v)"
        />
      </label>

      <!-- remote enabled -->
      <template v-if="isRemote">
        <!-- The QR is for one specific moment (pointing a phone at the screen) and was taking the
             top third of the dialog every other time. It's behind the QR button beside the URL now,
             and reveals with the same grid-rows animation the repo sections use. -->
        <div v-if="store.tunnelUrl" class="qr-reveal" :class="!showQr && 'is-hidden'">
          <div class="min-h-0 overflow-hidden">
            <div class="flex flex-col items-center gap-2.5 pb-1">
              <!-- eslint-disable-next-line vue/no-v-html -- QR SVG generated locally from our own URL -->
              <div v-if="qrSvg" class="size-44 rounded-md bg-white p-2 [&>svg]:size-full" v-html="qrSvg" />
              <p class="text-center text-[12px] text-muted-foreground">{{ $t("remote.scanHint") }}</p>
            </div>
          </div>
        </div>
        <div
          v-if="!store.tunnelUrl"
          class="flex items-center justify-center gap-2 rounded-md border border-border bg-secondary/30 py-4 text-[13px] text-muted-foreground"
        >
          <Loader2 :size="15" class="animate-spin" /> {{ $t("remote.starting") }}
        </div>

        <!-- min-w-0: this block is a direct grid item of DialogContent (display:grid), whose
             default min-width:auto would otherwise let the auto column grow to the URL's
             max-content and push the copy button off the dialog. min-w-0 lets the column
             shrink so the <code> below can truncate. -->
        <div v-if="store.tunnelUrl" class="flex min-w-0 flex-col gap-1.5">
          <span class="text-[12px] text-muted-foreground">{{ $t("remote.activeLabel") }}</span>
          <div class="flex items-center gap-2">
            <!-- Copy lives INSIDE the URL box, surfacing on hover/focus. It was a permanent
                 button competing with the URL for the row's width; the box is the thing you'd
                 reach for anyway. `group-focus-within` keeps it reachable by keyboard, where a
                 hover-only affordance would be invisible. -->
            <div class="group relative min-w-0 flex-1">
              <code
                class="mono block min-w-0 truncate rounded-md border border-border bg-secondary/40 py-2 pr-9 pl-2.5 text-[12px]"
              >{{ store.tunnelUrl }}</code>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                    :aria-label="$t('remote.copy')"
                    @click="copyLink"
                  >
                    <Check v-if="copied" class="text-success" />
                    <Copy v-else />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ $t("remote.copy") }}</TooltipContent>
              </Tooltip>
            </div>
            <!-- …and the slot the copy button used to occupy now toggles the QR. -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="secondary"
                  size="icon"
                  :aria-label="$t('remote.qrToggle')"
                  :aria-expanded="showQr"
                  @click="showQr = !showQr"
                >
                  <QrCode />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ $t("remote.qrToggle") }}</TooltipContent>
            </Tooltip>
          </div>
          <a
            :href="store.tunnelUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-1 inline-flex items-center justify-center gap-1.5 text-[12.5px] text-primary underline-offset-2 transition-colors hover:underline"
          >
            <ExternalLink :size="14" /> {{ $t("remote.open") }}
          </a>
        </div>

        <p class="text-center text-[12px] text-muted-foreground">
          {{ store.authenticated ? $t("remote.signedInAs", { name: store.owner }) : $t("remote.localBypassActive") }}
        </p>
      </template>

      <!-- The tunnel URL gives someone your whole dashboard; a share link gives them a scoped,
           expiring, revocable view of chosen repos. That lives in Settings → Access, which is
           unfindable from here — so say it exists, and go there. -->
      <div
        v-if="!store.isGuest"
        class="flex flex-col gap-2 rounded-md border border-border bg-secondary/25 p-3"
      >
        <p class="text-[12.5px] leading-snug text-muted-foreground">{{ $t("remote.shareHint") }}</p>
        <Button variant="secondary" size="sm" class="self-start" @click="openShareLinks">
          <Share2 />
          {{ $t("remote.shareCta") }}
        </Button>
      </div>

      <!-- local only -->
      <div
        v-else
        class="flex items-start gap-2 rounded-md border border-border bg-secondary/30 p-3 text-[12.5px] text-muted-foreground"
      >
        <Laptop :size="15" class="mt-0.5 shrink-0" />
        <span>{{ $t("remote.localBody") }}</span>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
/* Same grid-rows reveal the dashboard sections use: animates without measuring a height, and
   without unmounting the QR (which would re-run the lazy render every time you peeked). */
.qr-reveal {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 0.22s ease;
}
.qr-reveal.is-hidden {
  grid-template-rows: 0fr;
}
@media (prefers-reduced-motion: reduce) {
  .qr-reveal {
    transition: none;
  }
}
</style>
