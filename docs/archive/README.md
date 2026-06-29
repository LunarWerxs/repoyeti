# Archived cleanup audit (June 2026)

These are historical, **completed** — kept for the record, not active TODOs.

- `delete_gpt.md`, `despoke_gpt.md`, `deviant_gpt.md`, `dry_gpt.md`, `slow_gpt.md` — five
  independent audit passes (deletion/consolidation, dependency, deviant-behavior, DRY, and
  performance) over the codebase.
- `verified_gpt.md` — the consolidated, de-duplicated tracker that merged the five audits
  against the live code and tracked each item Completed / Keep-Do-Next / Dropped.

The actionable backlog from `verified_gpt.md` was worked through and landed on `main`
(commits `148fc7b`, `3089ed7`, `3a10989`): centralized API error contracts, OS-keychain
secrets (Bun.secrets), AI adapter/catalog consolidation, streamed AI diff collection,
progressive discovery, English-only i18n, changed-file tree perf + truncation notice, OIDC
protocol tests, and zod request validation. A couple of intentionally-deferred, low-value
items (shared status-badge helpers; the gated tray rebuild-menu removal) were left undone.
