import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import "../../src/cli-commands/inbox-policy.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("inbox-policy 命令与接线（作者锁定）", () => {
  it("命令已注册、清单末尾追加、子命令齐全", () => {
    expect(listCliCommands().map((c) => c.name)).toContain("inbox-policy");
    const cli = read("../../src/cli.ts");
    expect(cli).toMatch(/命令:[^\n]*\| inbox-policy/);
    const src = read("../../src/cli-commands/inbox-policy.ts");
    for (const sub of ['"show"', '"absence"', '"present"', '"cap"', '"ttl"']) expect(src).toContain(sub);
    expect(src).toContain("inbox-policy.json");
  });

  it("视图状态读策略并传给聚合；侧栏/底栏用 countActionableGates", () => {
    const view = read("../../src/server/view-state.ts");
    expect(view).toContain("loadInboxPolicy(");
    expect((view.match(/policy/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(read("../../src/server/ui/sidebar.ts")).toContain("countActionableGates(");
    expect(read("../../src/server/ui/mobile-tabbar.ts")).toContain("countActionableGates(");
  });
});