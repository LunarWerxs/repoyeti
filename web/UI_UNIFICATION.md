# Web UI Unification — superseded by the LunarWerx UI kit

> **Status (2026-07-02): superseded.** The shared design system now lives in a
> dedicated kit repo, **`lunarwerx-ui`** (`D:\PublicProjects\lunarwerx-ui`), and is
> **synced** into each app rather than hand-maintained per repo. This file is kept
> for history/links; the kit's `README.md` is the source of truth.

## What changed
**RepoYeti**, **DevWebUI**, and **Reimagine** now share one design system based on
the shadcn-vue **`reka-mira`** style (compact / dense):

- **One kit, synced.** `lunarwerx-ui` holds the canonical tokens, the 27-family
  compact Mira `components/ui` superset, the shared shell (`AppContainer`,
  `SettingsPanel`, `usePushPanel`), and `lib/utils`. `node sync.mjs` copies each
  app's family subset in; **only the accent CSS differs per app.** Edit the kit,
  not the synced copies.
- **Per-app accent only:** RepoYeti green, DevWebUI indigo, Reimagine violet.
  Everything else — the neutral palette, `--radius: 0.625rem`, Inter type, and the
  component set — is identical.
- **Unified content width:** **800px** via the `--container-max` token /
  `AppContainer` (was RepoYeti `max-w-3xl`, DevWebUI `max-w-7xl`).
- **Settings = pure-push slide-in** (`SettingsPanel` + `usePushPanel`): on desktop
  it pushes page content left with **no backdrop**; on mobile it's a bottom sheet.
- **Icons:** `@lucide/vue` everywhere (`lucide-vue-next` dropped from Reimagine).
- Each app carries a real `components.json` (`style: reka-mira`, `baseColor: neutral`).

## Not yet unified (tracked follow-ups)
- **Theme composable.** Each app still keeps its own color-mode composable
  (`useRepoYetiColorMode` / `useColorMode` / `useTheme`); a shared `lib/theme.ts`
  exists in the kit but is intentionally **not synced yet**. Dark-default is not
  uniform (DevWebUI still follows the OS).
- **Runtime / visual QA** across the three apps is still pending (the builds and
  type-checks pass, but the running UIs haven't been eyeballed together).

See `lunarwerx-ui/README.md` for the sync workflow and one-time per-app wiring.
