import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function read(relative: string): string {
  return readFileSync(join(repoRoot, relative), "utf8");
}

const CORE_CLAUSE = "断言必须瞄准仍会真实执行的路径";
const CORE_CRITERIA = [
  "已完成的一次性迁移会 early-return",
  "先证明**本该有变化**",
  "否则上一波留下的产物会给「什么都没干」发通过",
];
const CONVENTION_CLAUSES = [
  "启动路径上的强校验不得因历史遗留数据砖化服务",
  "外部进程持有 fd 的日志文件绝不能用 rename/unlink 轮转",
  "多 H1 spec 的 scope 块会聚合成全局并集",
  "launchd 服务「进不去」先分清崩溃循环还是源站正常",
];

describe("2026-08-06 停机教训已焊进宪法", () => {
  it("core.md 的 C3 含新断言纪律，三条判据都在", () => {
    const core = read("constitution/core.md");
    expect(core).toContain(CORE_CLAUSE);
    for (const criterion of CORE_CRITERIA) expect(core).toContain(criterion);
  });

  it("core.md 的 C3 原有正文一个字没动", () => {
    const core = read("constitution/core.md");
    expect(core).toContain("## C3 · 验证不可伪造");
    expect(core).toContain("无证据 = 未完成。");
  });

  it("conventions.md 含四条新约定", () => {
    const conventions = read("constitution/conventions.md");
    for (const clause of CONVENTION_CLAUSES) expect(conventions).toContain(clause);
  });

  it("conventions.md 既有关键条目没被删", () => {
    const conventions = read("constitution/conventions.md");
    expect(conventions).toContain("【军规·零漂移】改鲲鹏功能一律走自建 loop");
    expect(conventions).toContain("【军规·不准隐身】任何 agent 开工必注册到所属项目");
    expect(conventions).toContain("【YAGNI·最懒资深工程师】");
    expect(conventions).toContain("fail-closed，不静默吞错");
  });

  it("AGENTS.md 已镜像 core 与 conventions 的全部新内容", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain(CORE_CLAUSE);
    for (const criterion of CORE_CRITERIA) expect(agents).toContain(criterion);
    for (const clause of CONVENTION_CLAUSES) expect(agents).toContain(clause);
  });
});