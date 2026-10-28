import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderActionLevelTable } from "../../src/policy/action-levels.js";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("分级表被宪法、收件箱、运营环共同引用（作者锁定）", () => {
  it("constitution/core.md 的 C5 逐字嵌入 renderActionLevelTable() 与合成证据硬规则", () => {
    const core = read("../../../constitution/core.md");
    const c5 = core.indexOf("## C5");
    const c6 = core.indexOf("## C6");
    expect(c5).toBeGreaterThan(-1);
    expect(c6).toBeGreaterThan(c5);
    const section = core.slice(c5, c6);
    expect(section).toContain("3. 对外发布 / 操控已登录的第三方后台");
    expect(section).toContain("**动作分级（L0–L4，单一来源 `orchestrator/src/policy/action-levels.ts`，收件箱与运营环都引用它）**");
    expect(section).toContain(renderActionLevelTable());
    expect(section).toContain("L3/L4 门的证据必须是真实遥测或人工产出；AI 裁判的输出与合成用户信号只能推动 L0–L1，其结论进收件箱须标注「合成」。");
  });

  it("loop/types 转发单一来源；聚合与收件箱视图引用谓词而非写死 L3/L4", () => {
    const types = read("../../src/loop/types.ts");
    expect(types).toContain('from "../policy/action-levels.js"');
    expect(types).not.toMatch(/ACTION_LEVELS\s*=\s*\[/);
    const agg = read("../../src/server/state-snapshot-aggregates.ts");
    expect(agg).toContain("isHardGateLevel(");
    expect(agg).toContain("levelPriority(");
    expect(agg).not.toContain('"L3"');
    expect(agg).not.toContain('"L4"');
    const view = read("../../src/server/ui/views/review-inbox.ts");
    expect(view).toContain("actionLevelRow(");
  });
});