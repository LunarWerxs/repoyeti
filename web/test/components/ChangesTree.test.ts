import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { i18n } from "@/i18n";
import ChangesTree from "@/components/ChangesTree.vue";
import type { TreeNode } from "@/types";

vi.mock("@/lib/file-icons", () => ({ fileVisual: () => "span" }));

const nodes: TreeNode[] = ["a.ts", "b.ts", "c.ts"].map((name) => ({
  name,
  path: name,
  type: "file",
  status: "M",
  staged: false,
}));

describe("ChangesTree keyboard navigation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("moves the roving tab stop without scanning every row on each arrow key", async () => {
    const wrapper = mount(ChangesTree, {
      props: { nodes, repoId: "repo-1" },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const rows = wrapper.findAll<HTMLElement>("button[data-tree-row]");
    expect(rows.map((row) => row.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);

    rows[0]!.element.focus();
    const root = wrapper.get<HTMLElement>("[data-changes-root]");
    const fullScan = vi.spyOn(root.element, "querySelectorAll");
    await rows[0]!.trigger("keydown", { key: "ArrowDown" });

    expect(document.activeElement).toBe(rows[1]!.element);
    expect(rows.map((row) => row.attributes("tabindex"))).toEqual(["-1", "0", "-1"]);
    expect(fullScan).not.toHaveBeenCalled();

    wrapper.unmount();
  });
});
