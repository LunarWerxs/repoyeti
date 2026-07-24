import { afterEach, describe, expect, it } from "vitest";
import { cardKeepAlive } from "@/lib/card-keepalive";

const handles = Array.from({ length: 9 }, (_, i) => cardKeepAlive(`keepalive-test-${i}`));

describe("cardKeepAlive", () => {
  afterEach(() => {
    for (const handle of handles) handle.release();
  });

  it("releases temporary oversize as soon as an open card collapses", () => {
    // All nine bodies must remain resident while open, even though the collapsed-body cap is 8.
    for (const handle of handles) handle.onToggle(true);
    expect(handles.every((handle) => handle.keep())).toBe(true);

    // Once one body becomes safely evictable, residency returns to the cap immediately.
    handles[8]!.onToggle(false);
    expect(handles[8]!.keep()).toBe(false);
    expect(handles.slice(0, 8).every((handle) => handle.keep())).toBe(true);
  });
});
