import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_ROOT = resolve(import.meta.dir, "..");
const CHECK_TIMEOUT_MS = 30_000;
const APPLY_TIMEOUT_MS = 120_000;
const BUILD_TIMEOUT_MS = 240_000;

export interface UpdateStatus {
  ok: boolean;
  service: "repoyeti";
  currentVersion: string;
  currentCommit: string | null;
  remoteCommit: string | null;
  branch: string | null;
  upstream: string | null;
  remote: string | null;
  dirty: boolean;
  updateAvailable: boolean;
  canApply: boolean;
  checkedAt: number;
  reason: string | null;
}

export interface UpdateApplyResult {
  ok: boolean;
  message: string;
  restartRequired: boolean;
  status: UpdateStatus;
  output: string[];
}

interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(APP_ROOT, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function runCommand(args: string[], timeoutMs: number): Promise<CommandResult> {
  const proc = Bun.spawn(args, {
    cwd: APP_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0 && !timedOut, code, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timeout);
  }
}

async function git(args: string[], timeoutMs = CHECK_TIMEOUT_MS): Promise<CommandResult> {
  return runCommand(["git", ...args], timeoutMs);
}

async function gitText(args: string[], timeoutMs = CHECK_TIMEOUT_MS): Promise<string | null> {
  const r = await git(args, timeoutMs);
  if (!r.ok) return null;
  return r.stdout.trim();
}

function parseRemoteHead(stdout: string): { branch: string | null; commit: string | null } {
  const branch = stdout.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/m)?.[1] ?? null;
  const commit = stdout.match(/^([0-9a-f]{40})\s+HEAD$/m)?.[1] ?? null;
  return { branch, commit };
}

function parseLsRemoteCommit(stdout: string): string | null {
  return stdout.match(/^([0-9a-f]{40})\s+/m)?.[1] ?? null;
}

function configuredUpdateRemote(): string | null {
  const env = process.env.REPOYETI_UPDATE_REPO?.trim();
  return env || null;
}

async function currentUpstream(): Promise<{ upstream: string | null; remoteName: string | null; remoteBranch: string | null }> {
  const upstream = await gitText(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!upstream) return { upstream: null, remoteName: null, remoteBranch: null };
  const slash = upstream.indexOf("/");
  if (slash <= 0) return { upstream, remoteName: null, remoteBranch: null };
  return {
    upstream,
    remoteName: upstream.slice(0, slash),
    remoteBranch: upstream.slice(slash + 1),
  };
}

async function remoteForCheck(remoteName: string | null): Promise<{ remote: string | null; remoteArg: string | null }> {
  const configured = configuredUpdateRemote();
  if (configured) return { remote: configured, remoteArg: configured };

  const name = remoteName || "origin";
  const url = await gitText(["remote", "get-url", name]);
  if (url) return { remote: url, remoteArg: name };
  return { remote: null, remoteArg: null };
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  const checkedAt = Date.now();
  const base = {
    ok: true,
    service: "repoyeti" as const,
    currentVersion: packageVersion(),
    currentCommit: null as string | null,
    remoteCommit: null as string | null,
    branch: null as string | null,
    upstream: null as string | null,
    remote: null as string | null,
    dirty: false,
    updateAvailable: false,
    canApply: false,
    checkedAt,
    reason: null as string | null,
  };

  if (!existsSync(resolve(APP_ROOT, ".git"))) {
    return { ...base, ok: false, reason: "not a git checkout" };
  }

  const inside = await gitText(["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return { ...base, ok: false, reason: "not a git checkout" };

  const currentCommit = await gitText(["rev-parse", "HEAD"]);
  const branch = await gitText(["branch", "--show-current"]);
  const upstream = await currentUpstream();
  const remote = await remoteForCheck(upstream.remoteName);
  const dirty = !!(await gitText(["status", "--porcelain"]));

  const status: UpdateStatus = {
    ...base,
    currentCommit,
    branch,
    upstream: upstream.upstream,
    remote: remote.remote,
    dirty,
  };

  if (!currentCommit) return { ...status, ok: false, reason: "could not read current commit" };
  if (!remote.remoteArg) return { ...status, ok: false, reason: "no update remote configured" };

  const compareBranch = upstream.remoteBranch || branch;
  let remoteCommit: string | null = null;
  if (compareBranch) {
    const ref = await git(["ls-remote", remote.remoteArg, `refs/heads/${compareBranch}`]);
    if (ref.ok) remoteCommit = parseLsRemoteCommit(ref.stdout);
  }
  if (!remoteCommit) {
    const head = await git(["ls-remote", "--symref", remote.remoteArg, "HEAD"]);
    if (head.ok) {
      const parsed = parseRemoteHead(head.stdout);
      remoteCommit = parsed.commit;
      status.branch = status.branch || parsed.branch;
    }
  }

  status.remoteCommit = remoteCommit;
  status.updateAvailable = !!(remoteCommit && remoteCommit !== currentCommit);
  status.canApply = status.updateAvailable && !dirty && !!(compareBranch || status.branch);
  status.reason = status.updateAvailable
    ? dirty
      ? "local changes must be committed or stashed before updating"
      : null
    : remoteCommit
      ? "up to date"
      : "could not read remote commit";
  return status;
}

function commandSummary(args: string[], result: CommandResult): string {
  const text = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n").trim();
  const suffix = result.timedOut ? "timed out" : result.ok ? "ok" : `exit ${result.code ?? "unknown"}`;
  return `$ ${args.join(" ")}\n${text || suffix}`;
}

async function runStep(args: string[], timeoutMs: number, output: string[]): Promise<void> {
  const result = await runCommand(args, timeoutMs);
  output.push(commandSummary(args, result));
  if (!result.ok) {
    const msg = result.stderr.trim() || result.stdout.trim() || `${args[0]} failed`;
    throw new Error(msg.split("\n")[0] ?? "update step failed");
  }
}

export async function applyUpdate(): Promise<UpdateApplyResult> {
  const before = await checkForUpdate();
  const output: string[] = [];
  if (!before.updateAvailable) {
    return {
      ok: true,
      message: before.reason === "up to date" ? "RepoYeti is already up to date." : "No update is available.",
      restartRequired: false,
      status: before,
      output,
    };
  }
  if (before.dirty) throw new Error("Commit or stash local changes before applying an update.");

  const upstream = await currentUpstream();
  const remote = await remoteForCheck(upstream.remoteName);
  const branch = upstream.remoteBranch || before.branch;
  if (!remote.remoteArg || !branch) throw new Error("No update remote/branch is configured.");

  const pullArgs = upstream.upstream
    ? ["git", "pull", "--ff-only"]
    : ["git", "pull", "--ff-only", remote.remoteArg, branch];
  await runStep(pullArgs, APPLY_TIMEOUT_MS, output);
  await runStep(["bun", "install"], BUILD_TIMEOUT_MS, output);
  await runStep(["bun", "run", "--cwd", "web", "build"], BUILD_TIMEOUT_MS, output);

  const status = await checkForUpdate();
  return {
    ok: true,
    message: "RepoYeti was updated. Restart the daemon to run the new code.",
    restartRequired: true,
    status,
    output,
  };
}
