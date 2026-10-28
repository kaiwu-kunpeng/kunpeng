import { describe, it, expect } from "vitest";
import { categorize, addEntry } from "../src/dossier/changelog.js";

describe("categorize", () => {
  it("feat->Added, fix->Fixed, perf/refactor/docs->Changed, security->Security", () => {
    expect(categorize("feat")).toBe("Added");
    expect(categorize("fix")).toBe("Fixed");
    expect(categorize("perf")).toBe("Changed");
    expect(categorize("refactor")).toBe("Changed");
    expect(categorize("security")).toBe("Security");
  });

  it("未知 type -> Changed", () => {
    expect(categorize("wat")).toBe("Changed");
  });
});

describe("addEntry", () => {
  it("空文件 -> 建骨架 + Unreleased + 类目 + 条目", () => {
    const out = addEntry(null, "Added", "新功能 X");
    expect(out).toContain("# Changelog");
    expect(out).toContain("## [Unreleased]");
    expect(out).toContain("### Added");
    expect(out).toContain("- 新功能 X");
  });

  it("同类目第二条追加到同一子标题下(不重复建类目)", () => {
    const a = addEntry(null, "Added", "第一条");
    const b = addEntry(a, "Added", "第二条");
    expect(b).toContain("- 第一条");
    expect(b).toContain("- 第二条");
    expect((b.match(/### Added/g) || []).length).toBe(1);
  });

  it("不同类目各自建子标题", () => {
    const a = addEntry(null, "Added", "加了");
    const b = addEntry(a, "Fixed", "修了");
    expect(b).toContain("### Added");
    expect(b).toContain("### Fixed");
    expect(b).toContain("- 加了");
    expect(b).toContain("- 修了");
  });

  it("已有发布版本节时,新条目仍进 Unreleased 而非旧版本", () => {
    const doc = "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- 老功能\n";
    const out = addEntry(doc, "Added", "新功能");
    expect(out.indexOf("新功能")).toBeLessThan(out.indexOf("## [1.0.0]"));
    expect(out).toContain("- 老功能");
  });
});
