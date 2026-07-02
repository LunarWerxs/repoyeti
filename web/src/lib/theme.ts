import { onBeforeUnmount } from "vue";
import { useColorMode } from "@vueuse/core";

const THEME_TRANSITION_MS = 280;
let previousResolvedMode: string | undefined;
let transitionTimer: number | undefined;
let activeScopes = 0;

function beginThemeTransition(nextMode: string): void {
  const changed = previousResolvedMode !== undefined && previousResolvedMode !== nextMode;
  previousResolvedMode = nextMode;

  if (
    !changed ||
    typeof window === "undefined" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  document.documentElement.classList.add("theme-transitioning");
  window.clearTimeout(transitionTimer);
  transitionTimer = window.setTimeout(() => {
    document.documentElement.classList.remove("theme-transitioning");
    transitionTimer = undefined;
  }, THEME_TRANSITION_MS);
}

export function useRepoYetiColorMode() {
  activeScopes += 1;
  onBeforeUnmount(() => {
    activeScopes -= 1;
    if (activeScopes > 0 || typeof window === "undefined") return;

    window.clearTimeout(transitionTimer);
    document.documentElement.classList.remove("theme-transitioning");
    transitionTimer = undefined;
  });

  return useColorMode({
    initialValue: "dark",
    disableTransition: false,
    onChanged(nextMode, applyMode) {
      beginThemeTransition(nextMode);
      applyMode(nextMode);
    },
  });
}
