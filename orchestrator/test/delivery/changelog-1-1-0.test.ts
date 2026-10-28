import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const log = readFileSync(new URL("../../../CHANGELOG.md", import.meta.url), "utf8");

const section = (header: string): string => {
  const start = log.indexOf(header);
  if (start < 0) return "";
  const rest = log.slice(start + header.length);
  const next = rest.search(/\n## \[/);
  return next < 0 ? rest : rest.slice(0, next);
};

describe("CHANGELOG 1.1.0 收口(作者锁定)", () => {
  it("三个版本段按顺序存在", () => {
    const u = log.indexOf("## [Unreleased]");
    const v11 = log.indexOf("## [1.1.0] - 2026-09-14");
    const v10 = log.indexOf("## [1.0.0] - 2026-07-24");
    expect(u).toBeGreaterThan(0);
    expect(v11).toBeGreaterThan(u);
    expect(v10).toBeGreaterThan(v11);
  });

  it("1.1.0 收口的条目没有留在 Unreleased 段", () => {
    const body = section("## [Unreleased]");
    for (const s of ["auth add-user", "P0 数据丢失", "P0 交付阻断", "re-export shim", "DashboardState"]) {
      expect(body, `Unreleased 段仍包含 ${s}`).not.toContain(s);
    }
  });

  it("原 Unreleased 内容原样搬进 1.1.0 段(不是删掉)", () => {
    const body = section("## [1.1.0] - 2026-09-14");
    for (const s of ["auth add-user", "P0 数据丢失", "P0 交付阻断", "re-export shim", "DashboardState", "### Added", "### Fixed", "### Changed", "### Removed"]) {
      expect(body, `1.1.0 段缺 ${s}`).toContain(s);
    }
    expect(body.split("\n").filter((l) => l.startsWith("- ")).length).toBeGreaterThanOrEqual(20);
  });

  it("1.0.0 段未被动过", () => {
    expect(section("## [1.0.0] - 2026-07-24")).toContain("首个正式版本冻结商业化交付基线");
  });
});
