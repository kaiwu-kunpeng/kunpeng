import { describe, it, expect } from "vitest";
import { diffEarsSpecs, formatSpecDelta } from "../../src/spec/delta-spec.js";

const BASE = `
THE SYSTEM SHALL persist captures.
WHEN a flow rolls back THE SYSTEM SHALL record the blocker.
THE SYSTEM SHALL list captures.
`;

const NEXT = `
THE SYSTEM SHALL persist captures.
WHEN a flow rolls back THE SYSTEM SHALL record the blocker.
THE SYSTEM SHALL delete captures.
`;

describe("diffEarsSpecs", () => {
  it("分类新增/移除/保留", () => {
    const d = diffEarsSpecs(BASE, NEXT);
    expect(d.added.map((r) => r.response)).toContain("delete captures.");
    expect(d.removed.map((r) => r.response)).toContain("list captures.");
    expect(d.retained.map((r) => r.response).sort()).toEqual(
      ["persist captures.", "record the blocker."].sort(),
    );
  });

  it("无变化时 added/removed 为空、retained 全保留", () => {
    const d = diffEarsSpecs(BASE, BASE);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.retained).toHaveLength(3);
  });

  it("忽略非 EARS 行", () => {
    const d = diffEarsSpecs("随便一句不是 EARS 的话\n", "THE SYSTEM SHALL do x.\n");
    expect(d.added).toHaveLength(1);
    expect(d.removed).toHaveLength(0);
    expect(d.retained).toHaveLength(0);
  });

  it("trigger 不同视为不同需求", () => {
    const a = "WHEN x THE SYSTEM SHALL act.\n";
    const b = "WHEN y THE SYSTEM SHALL act.\n";
    const d = diffEarsSpecs(a, b);
    expect(d.added).toHaveLength(1);
    expect(d.removed).toHaveLength(1);
    expect(d.retained).toHaveLength(0);
  });
});

describe("formatSpecDelta", () => {
  it("一行摘要含三个计数", () => {
    const s = formatSpecDelta(diffEarsSpecs(BASE, NEXT));
    expect(s).toContain("+1");
    expect(s).toContain("-1");
    expect(s).toContain("=2");
  });
});