import { describe, it, expect } from "vitest";
import { isAgentRegistryFile, planScopeViolations } from "../../src/plan/orchestrator.js";

const SPEC = [
  "# demo",
  "",
  "```scope",
  "allow: lib/thing.ts",
  "forbid: app/**",
  "```",
  "",
].join("\n");

describe("isAgentRegistryFile", () => {
  it("旧形态仍豁免", () => {
    expect(isAgentRegistryFile("AGENTS-ACTIVE.md")).toBe(true);
    expect(isAgentRegistryFile("sub/AGENTS-ACTIVE.md")).toBe(true);
  });

  it("新形态(每条一文件)被豁免", () => {
    expect(isAgentRegistryFile(".kunpeng/agents-active/2026-08-15T14-38-49.174Z-cc-x.md")).toBe(true);
    expect(isAgentRegistryFile("sub/.kunpeng/agents-active/x.md")).toBe(true);
  });

  it("要害:不得把 .kunpeng 下的其它东西一并豁免", () => {
    expect(isAgentRegistryFile(".kunpeng/loops/demo-catalog.json")).toBe(false);
    expect(isAgentRegistryFile(".kunpeng/state/some-flow.json")).toBe(false);
    expect(isAgentRegistryFile(".kunpeng/specs/2026-08-01-x.md")).toBe(false);
    expect(isAgentRegistryFile(".kunpeng/agents-active/notes.json")).toBe(false);
    expect(isAgentRegistryFile(".kunpeng/agents-active-other/x.md")).toBe(false);
    expect(isAgentRegistryFile("lib/agents-active/x.md")).toBe(false);
  });

  it("普通实现文件不被豁免", () => {
    expect(isAgentRegistryFile("lib/thing.ts")).toBe(false);
    expect(isAgentRegistryFile("app/page.tsx")).toBe(false);
  });
});

describe("planScopeViolations 与登记豁免", () => {
  it("只改了一个新形态登记文件 → 无越界", () => {
    const v = planScopeViolations(SPEC, [
      "lib/thing.ts",
      ".kunpeng/agents-active/2026-08-15T14-38-49.174Z-cc-x.md",
    ]);
    expect(v).toEqual([]);
  });

  it("登记文件被豁免,但真越界仍要报出来", () => {
    const v = planScopeViolations(SPEC, [
      ".kunpeng/agents-active/2026-08-15T14-38-49.174Z-cc-x.md",
      ".kunpeng/loops/demo-catalog.json",
    ]);
    expect(v.length).toBeGreaterThan(0);
    expect(v.map((x) => x.file)).toContain(".kunpeng/loops/demo-catalog.json");
    expect(v.map((x) => x.file)).not.toContain(".kunpeng/agents-active/2026-08-15T14-38-49.174Z-cc-x.md");
  });
});