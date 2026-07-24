import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import MonacoViewer from "@/components/MonacoViewer.vue";

const monacoMock = vi.hoisted(() => {
  const state: { value: string; alternativeVersion: number; listener?: () => void } = {
    value: "initial",
    alternativeVersion: 1,
  };
  const model = {
    getValue: vi.fn(() => state.value),
    setValue: vi.fn((value: string) => {
      state.value = value;
      state.alternativeVersion++;
      state.listener?.();
    }),
    getAlternativeVersionId: vi.fn(() => state.alternativeVersion),
    setEOL: vi.fn(),
    dispose: vi.fn(),
  };
  const editor = {
    onDidChangeModelContent: vi.fn((listener: () => void) => {
      state.listener = listener;
      return { dispose: vi.fn() };
    }),
    deltaDecorations: vi.fn(() => []),
    updateOptions: vi.fn(),
    setModel: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
  };
  const api = {
    Uri: { file: vi.fn((path: string) => ({ path })) },
    Range: class {},
    editor: {
      OverviewRulerLane: { Left: 1 },
      getModel: vi.fn(() => null),
      createModel: vi.fn(() => model),
      create: vi.fn(() => editor),
      setTheme: vi.fn(),
    },
  };
  return { state, model, editor, api };
});

vi.mock("@/lib/monaco-setup", () => ({
  getMonaco: vi.fn(async () => monacoMock.api),
  monacoThemeFor: vi.fn(() => "vs-dark"),
}));

describe("MonacoViewer", () => {
  afterEach(() => {
    vi.clearAllMocks();
    monacoMock.state.value = "initial";
    monacoMock.state.alternativeVersion = 1;
    monacoMock.state.listener = undefined;
  });

  it("emits version-based dirty state without copying the full buffer on each edit", async () => {
    const wrapper = mount(MonacoViewer, {
      props: { value: "initial", filename: "large.txt", theme: "dark", editable: true },
    });
    await flushPromises();

    monacoMock.model.getValue.mockClear();
    monacoMock.state.value = "latest complete buffer";
    monacoMock.state.alternativeVersion = 2;
    monacoMock.state.listener?.();

    expect(wrapper.emitted("change")?.at(-1)).toEqual([true]);
    expect(monacoMock.model.getValue).not.toHaveBeenCalled();

    const exposed = wrapper.vm as unknown as {
      getValue: () => string;
      getSnapshot: () => { value: string; alternativeVersionId: number };
      markClean: (alternativeVersionId?: number) => boolean;
    };
    expect(exposed.getValue()).toBe("latest complete buffer");
    expect(monacoMock.model.getValue).toHaveBeenCalledOnce();

    const saved = exposed.getSnapshot();
    exposed.markClean(saved.alternativeVersionId);
    expect(wrapper.emitted("change")?.at(-1)).toEqual([false]);

    // An edit that lands while Save is in flight stays dirty against the saved version.
    monacoMock.state.alternativeVersion = 3;
    monacoMock.state.listener?.();
    expect(wrapper.emitted("change")?.at(-1)).toEqual([true]);
    expect(exposed.markClean(saved.alternativeVersionId)).toBe(true);
    expect(wrapper.emitted("change")?.at(-1)).toEqual([true]);

    // Monaco's undo version returns to the saved id.
    monacoMock.state.alternativeVersion = 2;
    monacoMock.state.listener?.();
    expect(wrapper.emitted("change")?.at(-1)).toEqual([false]);

    wrapper.unmount();
  });
});
