// ⭐ Identity Firewall — client-side mirror of src/identity.ts's tiny glob matcher + rule check,
// so the repo card badge (RepoCardHeader.vue) can flag a violation locally without a round-trip.
// Kept intentionally identical in spirit (not literally shared — the daemon is the source of
// truth that actually blocks the action; this is display-only).
import type { IdentityRule, Repo } from "../types";

/** Compile a glob pattern into a RegExp. Mirrors src/identity.ts globToRegExp exactly:
 *  `**` → `.*`; `*` → `[^/]*`; `?` → `[^/]`; everything else escaped literally. */
function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/").trim();
  let out = "";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`, "i");
}

function globMatch(pattern: string, absPath: string): boolean {
  if (!pattern.trim()) return false;
  const path = absPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return globToRegExp(pattern).test(path);
}

/** The first rule (in array order) whose pathPattern matches `absPath`, or null. */
export function matchIdentityRule(absPath: string, rules: IdentityRule[]): IdentityRule | null {
  for (const rule of rules) {
    if (globMatch(rule.pathPattern, absPath)) return rule;
  }
  return null;
}

/** Does this repo currently violate an Identity Firewall rule (matches a rule whose
 *  `requiredIdentityId` differs from the repo's own resolved `identityId`)? Display-only —
 *  the daemon is what actually blocks the mutating action. */
export function repoViolatesIdentityRule(repo: Repo, rules: IdentityRule[]): IdentityRule | null {
  const rule = matchIdentityRule(repo.absPath, rules);
  if (!rule) return null;
  return repo.identityId === rule.requiredIdentityId ? null : rule;
}
