<script setup lang="ts">
import { computed } from "vue";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTheme } from "@/lib/theme";
import { bulkBarHeight } from "@/lib/repo-selection";
import AppShell from "./AppShell.vue";

// Shared kit light/dark/system theme (defaults to dark — see index.html and the kit
// README "Theme boot snippet"). The Settings switcher writes the same store. `mode`
// ("light" | "dark" | "system") maps 1:1 to vue-sonner's theme prop.
const { mode } = useTheme();

// `expand` lays multiple toasts out vertically instead of sonner's default, which collapses
// older ones BEHIND the newest and only fans them out on hover. Collapsed is prettier, but it
// makes an older toast's action button physically unreachable — and ours carry Undo, so a second
// action would bury the undo for the first. Undo you can't click is worse than a taller stack.
//
// Toasts sit bottom-right, which is also where the multi-select bulk bar's buttons are. While
// that bar is up, stack the toasts above it instead of on top of it — landing on Undo is the
// worst case, since that's the control a mis-clicked bulk action depends on. 12px of breathing
// room; back to the plain 16px inset once the bar unmounts (it publishes a height of 0).
// Per-edge rather than a single number: a bare number sets ALL four insets, so lifting the stack
// clear of the bar would also shove it sideways off the right edge — the toasts would visibly
// slide left on entering select mode. Only the bottom should move.
const TOAST_INSET = 16;
const toastOffset = computed(() => ({
  top: TOAST_INSET,
  right: TOAST_INSET,
  left: TOAST_INSET,
  bottom: bulkBarHeight.value > 0 ? bulkBarHeight.value + TOAST_INSET + 12 : TOAST_INSET,
}));
</script>

<template>
  <TooltipProvider>
    <AppShell />
    <Toaster
      :theme="mode"
      position="bottom-right"
      :duration="3500"
      :offset="toastOffset"
      expand
      close-button
    />
  </TooltipProvider>
</template>
