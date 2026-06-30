import { describe, it, expect } from "vitest";
import { hasStat, fmtCount } from "@/lib/diffstat";

describe("hasStat", () => {
  it("is false for null / undefined", () => {
    expect(hasStat(null)).toBe(false);
    expect(hasStat(undefined)).toBe(false);
  });

  it("is false when every delta is zero", () => {
    expect(hasStat({ addedLines: 0, removedLines: 0, addedChars: 0, removedChars: 0 })).toBe(false);
  });

  it("is true when any single delta is non-zero", () => {
    expect(hasStat({ addedLines: 1, removedLines: 0, addedChars: 0, removedChars: 0 })).toBe(true);
    expect(hasStat({ addedLines: 0, removedLines: 0, addedChars: 0, removedChars: 5 })).toBe(true);
  });
});

describe("fmtCount", () => {
  it("renders small numbers verbatim", () => {
    expect(fmtCount(0)).toBe("0");
    expect(fmtCount(42)).toBe("42");
  });

  it("group-separates large numbers (locale toLocaleString)", () => {
    // en-US groups by thousands; assert structurally so it doesn't hard-fail under another locale.
    expect(fmtCount(1234)).toMatch(/^1[.,\s]?234$/);
  });
});
