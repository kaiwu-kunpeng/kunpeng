import { describe, it, expect } from "vitest";
import { parseSpecMeta, buildSpecIndex, renderSpecIndex, groupByFamily } from "../src/dossier/spec-index.js";

describe("parseSpecMeta", () => {
  it("取日期前缀 + H1 标题", () => {
    const m = parseSpecMeta("2026-06-20-foo.md", "# 标题 Foo\n\n正文");
    expect(m.date).toBe("2026-06-20");
    expect(m.title).toBe("标题 Foo");
  });
  it("解析 supersedes / status 行", () => {
    const m = parseSpecMeta("2026-06-20-bar.md", "# Bar\nsupersedes: 2026-06-19-old.md\nstatus: draft\n");
    expect(m.supersedes).toBe("2026-06-19-old.md");
    expect(m.status).toBe("draft");
  });
  it("无 H1 → 用文件名兜底", () => {
    expect(parseSpecMeta("x.md", "无标题").title).toBe("x");
  });
});

describe("buildSpecIndex", () => {
  const specs = [
    { filename: "2026-06-19-old.md", content: "# 旧版" },
    { filename: "2026-06-20-new.md", content: "# 新版\nsupersedes: 2026-06-19-old.md\n" },
    { filename: "2026-06-18-other.md", content: "# 其它" },
  ];
  it("标出被取代项", () => {
    const idx = buildSpecIndex(specs);
    expect(idx.find((e) => e.filename === "2026-06-19-old.md")?.superseded).toBe(true);
    expect(idx.find((e) => e.filename === "2026-06-20-new.md")?.superseded).toBe(false);
  });
  it("按日期降序", () => {
    const idx = buildSpecIndex(specs);
    expect(idx.map((e) => e.filename)).toEqual(["2026-06-20-new.md", "2026-06-19-old.md", "2026-06-18-other.md"]);
  });
});

describe("renderSpecIndex", () => {
  it("分活跃/已被取代两区 + 取代标注", () => {
    const md = renderSpecIndex(buildSpecIndex([
      { filename: "2026-06-19-old.md", content: "# 旧版" },
      { filename: "2026-06-20-new.md", content: "# 新版\nsupersedes: 2026-06-19-old.md\n" },
    ]));
    expect(md).toContain("## 活跃");
    expect(md).toContain("## 已被取代");
    expect(md).toContain("取代 2026-06-19-old.md");
    expect(md).toContain("活跃 1，已被取代 1");
  });
});

describe("groupByFamily", () => {
  const mk = (filename: string) => ({
    filename,
    date: filename.slice(0, 10),
    title: filename,
    superseded: false,
  });
  const entries = [
    mk("2026-06-19-module-status-builder.md"),
    mk("2026-06-19-module-status-cli.md"),
    mk("2026-06-19-module-status-core.md"),
    mk("2026-06-19-newcategory-a.md"),
    mk("2026-06-19-newcategory-b.md"),
    mk("2026-06-20-lonely-one.md"),
  ];

  it("同首词成族,≥3 才算族", () => {
    const families = groupByFamily(entries, 3);
    expect(families.map((family) => family.family)).toEqual(["module"]);
    expect(families[0].count).toBe(3);
  });

  it("minSize=2 时 newcategory 也成族,按份数降序", () => {
    const families = groupByFamily(entries, 2);
    expect(families.map((family) => family.family)).toEqual(["module", "newcategory"]);
  });

  it("单份不成族", () => {
    expect(groupByFamily(entries, 2).some((family) => family.family === "lonely")).toBe(false);
  });
});

describe("renderSpecIndex · 特性族区", () => {
  it("渲染特性族区", () => {
    const index = buildSpecIndex([
      { filename: "2026-06-19-module-status-builder.md", content: "# A" },
      { filename: "2026-06-19-module-status-cli.md", content: "# B" },
      { filename: "2026-06-19-module-status-core.md", content: "# C" },
    ]);
    const md = renderSpecIndex(index);
    expect(md).toContain("特性族");
    expect(md).toContain("**module**（3 份）");
  });
});
