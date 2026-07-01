// Remembers which Settings cards the user has expanded vs collapsed.
//
// Client-side preference, persisted to localStorage like the theme (§ changes-view.ts).
// One flat map of `sectionId → open?`. A missing key means "the user never touched this
// one" → fall back to the section's own `defaultOpen`, so we can change a default later
// without stomping on someone's saved choice.
import { useLocalStorage } from "@vueuse/core";
import { computed, type WritableComputedRef } from "vue";

const sectionState = useLocalStorage<Record<string, boolean>>("repoyeti:settingsSections", {});

/**
 * A two-way `open` boolean for one Settings section. Reading falls back to `defaultOpen`
 * until the user toggles it; writing records their choice so it sticks across reloads.
 */
export function useSectionOpen(id: string, defaultOpen: boolean): WritableComputedRef<boolean> {
  return computed<boolean>({
    get: () => sectionState.value[id] ?? defaultOpen,
    set: (v) => {
      sectionState.value[id] = v;
    },
  });
}
