import type { Ref } from "vue";
import { computed } from "vue";
import { useLockedSheetSide } from "@/lib/use-locked-sheet-side";

export const SETTINGS_PANEL_DESKTOP_QUERY = "(min-width: 768px)";
export const SETTINGS_PANEL_WIDTH = 448;

export function useSettingsPanelShift(open: Ref<boolean>) {
  const side = useLockedSheetSide(open, SETTINGS_PANEL_DESKTOP_QUERY);
  const shiftPx = computed(() => (open.value && side.value === "right" ? SETTINGS_PANEL_WIDTH : 0));

  return { side, shiftPx };
}
