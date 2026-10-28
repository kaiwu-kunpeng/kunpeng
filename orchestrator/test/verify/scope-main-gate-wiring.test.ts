import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), "utf8");

describe("范围门接线（作者锁定）", () => {
  it("kunpeng run 与 kunpeng plan 入口都用 resolveRequireScope(process.env) 翻默认", () => {
    expect(src("cli-commands/devcycle.ts")).toContain("requireScope: resolveRequireScope(process.env)");
    expect(src("cli-commands/loop-core.ts")).toContain("requireScope: resolveRequireScope(process.env)");
    expect(src("plan/orchestrator.ts")).toMatch(/requireScope:\s*d\.requireScope/);
  });
  it("DevCycle 主路径调用 evaluateScopeOnMainPath，且缺省语义仍看 this.d.requireScope ?? env===1", () => {
    const text = src("loop/dev-cycle.ts");
    expect(text).toContain("evaluateScopeOnMainPath(");
    expect(text).toMatch(/this\.d\.requireScope\s*\?\?\s*\(process\.env\.KUNPENG_REQUIRE_SCOPE === "1"\)/);
    expect(text).toContain('kind: "scope-gate"');
  });
  it("豁免函数已搬到 verify/scope-main-gate 并由 orchestrator 再导出", () => {
    expect(src("plan/orchestrator.ts")).toMatch(/export \{[^}]*isMachineSpecCopy[^}]*\} from "\.\.\/verify\/scope-main-gate\.js"/);
    expect(src("verify/scope-main-gate.ts")).toContain("export function isMachineSpecCopy");
  });
});