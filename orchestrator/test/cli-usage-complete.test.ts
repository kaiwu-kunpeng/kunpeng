import { describe, expect, it } from "vitest";
import { usageText } from "../src/cli.js";
import { listCliCommands } from "../src/cli-commands/registry.js";

function listedCommands(): string[] {
  return usageText().replace(/^命令:\s*/, "").split(" | ").map((s) => s.trim()).filter(Boolean);
}

describe("用法表必须覆盖全部已注册命令", () => {
  it("没有任何已注册命令被漏掉", () => {
    const listed = new Set(listedCommands());
    const missing = listCliCommands().map((c) => c.name).filter((n) => !listed.has(n));
    expect(missing, `这些命令注册了却没进用法表: ${missing.join(", ")}`).toEqual([]);
  });

  it("此前漏掉的 18 个现在都查得到", () => {
    const listed = new Set(listedCommands());
    for (const name of [
      "lib", "adr", "changelog", "send", "kickoff", "signal", "escalations",
      "switchboard-mcp", "register-agent", "auth", "design", "design-memory",
      "design-loop", "ops-pilot", "ops-report", "eval", "guardian-report", "install-hooks",
    ]) {
      expect(listed.has(name), `${name} 应当在用法表里`).toBe(true);
    }
  });

  it("没有重复项", () => {
    const listed = listedCommands();
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("列出的每一项都确实注册着(不列幽灵命令)", () => {
    const registered = new Set(listCliCommands().map((c) => c.name));
    const ghosts = listedCommands().filter((n) => !registered.has(n));
    expect(ghosts, `这些出现在用法表但没注册: ${ghosts.join(", ")}`).toEqual([]);
  });
});

describe("常用命令的顺序与既有断言不退化", () => {
  it("核心命令保持原有相对顺序", () => {
    const listed = listedCommands();
    const at = (name: string): number => listed.indexOf(name);
    expect(at("run")).toBeGreaterThanOrEqual(0);
    expect(at("run")).toBeLessThan(at("plan"));
    expect(at("plan")).toBeLessThan(at("product"));
    expect(at("product")).toBeLessThan(at("merge"));
    expect(at("serve")).toBeLessThan(at("worker"));
  });

  it("既有 cli-help 断言仍成立", () => {
    const t = usageText();
    for (const c of ["autopilot", "maintain", "status", "flywheel", "best-of-n", "workspace", "codegraph"]) {
      expect(t).toContain(c);
    }
    expect((t.match(/\bresume\b/g) ?? []).length).toBe(1);
  });

  it("本轮新增的 worker / deploy 也在", () => {
    const listed = new Set(listedCommands());
    expect(listed.has("worker")).toBe(true);
    expect(listed.has("deploy")).toBe(true);
  });

  it("幂等:多次调用结果一致", () => {
    expect(usageText()).toBe(usageText());
  });

  it("以「命令: 」开头", () => {
    expect(usageText().startsWith("命令: ")).toBe(true);
  });
});