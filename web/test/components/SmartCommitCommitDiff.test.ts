import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import SmartCommitCommitDiff from "@/components/SmartCommitCommitDiff.vue";
import { i18n } from "@/i18n";
import type { FileDiff } from "@/types";

interface PendingRequest {
  signal: AbortSignal;
  resolve: () => void;
}

function result(path: string): FileDiff {
  return {
    ok: true,
    code: "OK",
    path,
    mode: "models",
    original: "old",
    modified: "new",
  };
}

describe("SmartCommitCommitDiff", () => {
  afterEach(() => vi.restoreAllMocks());

  it("bounds concurrent diff requests and aborts the remaining work on unmount", async () => {
    const pending: PendingRequest[] = [];
    let active = 0;
    let peak = 0;

    vi.spyOn(api, "fileDiff").mockImplementation(
      (_repoId: string, path: string, signal?: AbortSignal) =>
        new Promise<FileDiff>((resolve, reject) => {
          if (!signal) throw new Error("expected an AbortSignal");
          active++;
          peak = Math.max(peak, active);
          let settled = false;
          const finish = (): void => {
            if (settled) return;
            settled = true;
            active--;
            resolve(result(path));
          };
          signal.addEventListener(
            "abort",
            () => {
              if (settled) return;
              settled = true;
              active--;
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
          pending.push({ signal, resolve: finish });
        }),
    );

    const files = Array.from({ length: 9 }, (_, i) => `file-${i}.ts`);
    const wrapper = mount(SmartCommitCommitDiff, {
      props: { repoId: "repo-1", files, statusByPath: {} },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    expect(api.fileDiff).toHaveBeenCalledTimes(4);
    expect(peak).toBe(4);

    pending[0]!.resolve();
    await flushPromises();
    expect(api.fileDiff).toHaveBeenCalledTimes(5);
    expect(peak).toBe(4);

    wrapper.unmount();
    await flushPromises();

    expect(pending.slice(1).every((request) => request.signal.aborted)).toBe(true);
    expect(active).toBe(0);
    expect(api.fileDiff).toHaveBeenCalledTimes(5);
  });
});
