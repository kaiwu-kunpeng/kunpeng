import { describe, it, expect } from "vitest";
import { parseProjectMd, parseChangelogUnreleased, parseAdrList } from "../src/server/dossier-state.js";

describe("parseProjectMd", () => {
  const md = [
    "# x · 项目档案", "", "## 北极星 / 目标", "",
    "**北极星**：自主跑完并真过验收的流占比", "**当期目标**：① 稳定 ② 补产物管理", "",
    "## Roadmap", "", "**Now:** 档案层五件套", "", "**Next:** 估算校准", "", "**Later:** org 扩编",
  ].join("\n");
  it("提北极星/目标", () => {
    const v = parseProjectMd(md);
    expect(v.northStar).toContain("真过验收");
    expect(v.goals).toContain("补产物管理");
  });
  it("提 roadmap now/next/later", () => {
    const v = parseProjectMd(md);
    expect(v.roadmap.now).toBe("档案层五件套");
    expect(v.roadmap.next).toBe("估算校准");
    expect(v.roadmap.later).toBe("org 扩编");
  });
  it("缺字段给空串不崩", () => {
    expect(parseProjectMd("# 空").northStar).toBe("");
    expect(parseProjectMd("# 空").roadmap.now).toBe("");
  });
});

describe("parseChangelogUnreleased", () => {
  const cl = "# Changelog\n\n## [Unreleased]\n\n### Added\n- 功能A\n- 功能B\n\n### Fixed\n- 修了C\n\n## [0.1.0] - 2026-06-14\n\n### Added\n- 老D\n";
  it("按类目提 Unreleased 条目,不含已发布版本", () => {
    const u = parseChangelogUnreleased(cl);
    expect(u.total).toBe(3);
    expect(u.categories.find((c) => c.name === "Added")?.items).toEqual(["功能A", "功能B"]);
    expect(u.categories.find((c) => c.name === "Fixed")?.items).toEqual(["修了C"]);
    expect(JSON.stringify(u)).not.toContain("老D"); // 不串进已发布
  });
  it("无 Unreleased→空", () => {
    expect(parseChangelogUnreleased("# Changelog\n").total).toBe(0);
  });
});

describe("parseAdrList", () => {
  const files = [
    { filename: "0001-采用档案层.md", content: "# ADR-0001: 采用档案层\n\n- **Status**: Superseded by ADR-0002\n- **Date**: 2026-06-20\n" },
    { filename: "0002-标记块刷新.md", content: "# ADR-0002: 标记块刷新\n\n- **Status**: Accepted\n- **Date**: 2026-06-20\n" },
    { filename: "readme.md", content: "# 不是 ADR" },
  ];
  it("提 num/title/status/date,按 num 降序,跳过非 NNNN-", () => {
    const list = parseAdrList(files);
    expect(list.map((a) => a.num)).toEqual(["0002", "0001"]);
    expect(list[0].title).toBe("标记块刷新");
    expect(list[0].status).toBe("Accepted");
    expect(list[1].status).toContain("Superseded");
    expect(list[1].date).toBe("2026-06-20");
  });
});
