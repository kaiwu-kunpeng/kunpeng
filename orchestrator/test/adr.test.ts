import { describe, it, expect } from "vitest";
import { nextAdrNumber, adrSlug, adrFilename, renderAdr, supersedeStatus } from "../src/dossier/adr.js";

describe("nextAdrNumber", () => {
  it("空 -> 0001", () => {
    expect(nextAdrNumber([])).toBe("0001");
  });

  it("取最大+1 并补零", () => {
    expect(nextAdrNumber(["0001-a.md", "0003-b.md", "readme.md"])).toBe("0004");
  });

  it("忽略非 NNNN- 前缀", () => {
    expect(nextAdrNumber(["foo.md", "12-x.md"])).toBe("0001");
  });
});

describe("adrSlug / adrFilename", () => {
  it("kebab 化、去特殊字符", () => {
    expect(adrSlug("Use Postgres, not Mongo!")).toBe("use-postgres-not-mongo");
  });

  it("文件名 = NNNN-slug.md", () => {
    expect(adrFilename("0007", "Cache layer")).toBe("0007-cache-layer.md");
  });
});

describe("renderAdr", () => {
  it("含五要素 + 编号 + 标题 + 默认 Proposed", () => {
    const a = renderAdr("0002", "Adopt ESM", { dateISO: "2026-06-20" });
    expect(a).toContain("# ADR-0002: Adopt ESM");
    expect(a).toContain("**Status**: Proposed");
    expect(a).toContain("**Date**: 2026-06-20");
    expect(a).toContain("## Context");
    expect(a).toContain("## Decision");
    expect(a).toContain("## Consequences");
  });

  it("status 与 supersedes 生效", () => {
    const a = renderAdr("0005", "x", { dateISO: "2026-06-20", status: "Accepted", supersedes: "0003" });
    expect(a).toContain("**Status**: Accepted");
    expect(a).toContain("取代 ADR-0003");
  });
});

describe("supersedeStatus", () => {
  it("把既有 Status 行改成 Superseded by", () => {
    const old = "# ADR-0003: 旧决策\n\n- **Status**: Accepted\n- **Date**: 2026-06-01\n\n## Context\n";
    const out = supersedeStatus(old, "0005");
    expect(out).toContain("- **Status**: Superseded by ADR-0005");
    expect(out).not.toContain("**Status**: Accepted");
    expect(out).toContain("## Context");
  });
});
