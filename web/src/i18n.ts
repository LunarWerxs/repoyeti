// App-wide internationalisation (vue-i18n, Composition API) — English only.
//
// RepoYeti ships a single locale (English). The i18n layer is kept (rather than inlining raw
// strings) so all user-facing copy stays centralised in one `locales/en.json` and the build's
// `i18n:check` can flag any hardcoded/missing string. The bootstrap itself — locale persistence,
// `<html lang>` sync, and the supported-locale set — lives in the shared kit factory
// (`@/lib/i18n-core`, synced from lunarwerx-ui) so all three LunarWerx apps share one
// implementation. To reintroduce other languages later: add `locales/<code>.json` (key-parity
// with en.json) and a small locale switcher back.
import { createAppI18n } from "@/lib/i18n-core";
import en from "./locales/en.json";

export const { i18n, t } = createAppI18n({ en }, "repoyeti.locale");
