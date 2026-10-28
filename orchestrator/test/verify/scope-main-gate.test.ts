import { describe, expect, it } from "vitest";
import {
  evaluateScopeOnMainPath, isAgentRegistryFile, isMachineSpecCopy, parseChangedPaths, resolveRequireScope,
} from "../../src/verify/scope-main-gate.js";
import { isAgentRegistryFile as fromPlan, isMachineSpecCopy as copyFromPlan } from "../../src/plan/orchestrator.js";

describe("resolveRequireScope：默认开，只有显式关才关", () => {
  it.each([[{}, true], [{ KUNPENG_REQUIRE_SCOPE: "" }, true], [{ KUNPENG_REQUIRE_SCOPE: "1" }, true], [{ KUNPENG_REQUIRE_SCOPE: "true" }, true],
    [{ KUNPENG_REQUIRE_SCOPE: "0" }, false], [{ KUNPENG_REQUIRE_SCOPE: "false" }, false], [{ KUNPENG_REQUIRE_SCOPE: " OFF " }, false], [{ KUNPENG_REQUIRE_SCOPE: "no" }, false]])(
    "%j → %s", (env, expected) => { expect(resolveRequireScope(env as NodeJS.ProcessEnv)).toBe(expected); });
});

describe("parseChangedPaths", () => {
  it("拆行、去空、解 git 引号转义", () => {
    expect(parseChangedPaths('a.ts\n\n  b.ts  \n"c\\303\\244.ts"\n')).toEqual(["a.ts", "b.ts", "cä.ts"]);
  });
});

describe("豁免函数与 plan/orchestrator 是同一个引用", () => {
  it("isMachineSpecCopy / isAgentRegistryFile", () => {
    expect(copyFromPlan).toBe(isMachineSpecCopy);
    expect(fromPlan).toBe(isAgentRegistryFile);
    expect(isMachineSpecCopy("orchestrator/specs/2026-09-15-x.spec.md")).toBe(true);
    expect(isAgentRegistryFile(".kunpeng/agents-active/2026-09-15T00-00-00.000Z-x.md")).toBe(true);
    expect(isMachineSpecCopy("src/a.ts")).toBe(false);
  });
});

describe("evaluateScopeOnMainPath", () => {
  const ALLOW_IN = { allow: ["src/in/**"], forbid: [] };
  it("无 scope + requireScope → scope-missing", () => {
    const v = evaluateScopeOnMainPath(["src/x.ts"], undefined, { requireScope: true });
    expect(v.ok).toBe(false);
    if (!v.ok) { expect(v.reason).toBe("scope-missing"); expect(v.message).toContain("KUNPENG_REQUIRE_SCOPE=0"); }
  });
  it("无 scope + 不要求 → ok 且 skipped", () => {
    expect(evaluateScopeOnMainPath(["src/x.ts"], undefined, { requireScope: false })).toEqual({ ok: true, skipped: true, changedFiles: ["src/x.ts"] });
  });
  it("scope 坏 → scope-malformed（不看 requireScope）", () => {
    const v = evaluateScopeOnMainPath(["src/x.ts"], { allow: [], forbid: [], malformed: true }, { requireScope: false });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("scope-malformed");
  });
  it("只写 forbid → allow-missing（不看 requireScope）", () => {
    const v = evaluateScopeOnMainPath(["src/x.ts"], { allow: [], forbid: ["src/zzz/**"] }, { requireScope: false });
    expect(v.ok).toBe(false);
    if (!v.ok) { expect(v.reason).toBe("allow-missing"); expect(v.message).toContain("forbid"); }
  });
  it("越界 → drift，violations 与 message 点名文件", () => {
    const v = evaluateScopeOnMainPath(["src/in/a.ts", "src/out/b.ts"], ALLOW_IN, { requireScope: true });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe("drift");
      expect(v.violations).toEqual([{ file: "src/out/b.ts", rule: "outside-allow" }]);
      expect(v.message).toBe("范围门未通过：src/out/b.ts（outside-allow）");
    }
  });
  it("范围内 → ok 且 skipped=false", () => {
    expect(evaluateScopeOnMainPath(["src/in/a.ts"], ALLOW_IN, { requireScope: true })).toEqual({ ok: true, skipped: false, changedFiles: ["src/in/a.ts"] });
  });
  it("plan 归档副本与 agent 登记文件被豁免，不算越界", () => {
    const v = evaluateScopeOnMainPath(["orchestrator/specs/x.spec.md", ".kunpeng/agents-active/2026-a.md", "src/in/a.ts"], ALLOW_IN, { requireScope: true });
    expect(v).toEqual({ ok: true, skipped: false, changedFiles: ["src/in/a.ts"] });
  });
  it("空改动 + 有效 scope → ok", () => {
    expect(evaluateScopeOnMainPath([], ALLOW_IN, { requireScope: true }).ok).toBe(true);
  });
});