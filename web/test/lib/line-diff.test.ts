import { describe, it, expect } from "vitest";
import { diffLineChanges } from "@/lib/line-diff";

describe("diffLineChanges", () => {
  it("returns nothing for identical text", () => {
    expect(diffLineChanges("a\nb\nc\n", "a\nb\nc\n")).toEqual([]);
    expect(diffLineChanges("", "")).toEqual([]);
  });

  it("marks a modified line (modify) in place", () => {
    // line 2 changed
    expect(diffLineChanges("a\nb\nc", "a\nB\nc")).toEqual([{ startLine: 2, endLine: 2, kind: "modify" }]);
  });

  it("marks inserted lines as add", () => {
    // two lines inserted after line 1
    expect(diffLineChanges("a\nb", "a\nx\ny\nb")).toEqual([{ startLine: 2, endLine: 3, kind: "add" }]);
  });

  it("marks a pure deletion with a boundary marker", () => {
    // line 2 removed; the marker sits where it was (now line 2 = old line 3)
    const changes = diffLineChanges("a\nb\nc", "a\nc");
    expect(changes).toEqual([{ startLine: 2, endLine: 2, kind: "delete" }]);
  });

  it("appended lines at the end are add", () => {
    expect(diffLineChanges("a\nb", "a\nb\nc\nd")).toEqual([{ startLine: 3, endLine: 4, kind: "add" }]);
  });

  it("handles multiple independent regions", () => {
    const original = "1\n2\n3\n4\n5\n6";
    const modified = "1\nX\n3\n4\nY\n6"; // line 2 and line 5 changed
    expect(diffLineChanges(original, modified)).toEqual([
      { startLine: 2, endLine: 2, kind: "modify" },
      { startLine: 5, endLine: 5, kind: "modify" },
    ]);
  });

  it("treats a whole-new file as add", () => {
    expect(diffLineChanges("", "a\nb\nc")).toEqual([{ startLine: 1, endLine: 3, kind: "add" }]);
  });
});
