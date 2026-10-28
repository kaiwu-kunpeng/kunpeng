import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("稍后键与硬门二次确认接线（作者锁定）", () => {
  it("路由、能力表、视图状态", () => {
    const routes = read("../../src/server/routes/inbox.ts");
    expect(routes).toContain('"/api/inbox/defer"');
    expect(routes).toContain("InboxDeferStore");
    expect(routes).toContain("168");
    expect(read("../../src/server/authz.ts")).toContain('"POST /api/inbox/defer": "merge"');
    const view = read("../../src/server/view-state.ts");
    expect(view).toContain("InboxDeferStore");
    expect((view.match(/deferred/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("客户端：inbox-defer 动作、硬门 confirm、x 键", () => {
    const p7 = read("../../src/server/ui/client-parts/part07.ts");
    expect(p7).toContain('"inbox-defer"');
    expect(p7).toContain("/api/inbox/defer");
    expect(p7).toContain("data-kp-confirm");
    expect(p7).toContain("window.confirm");
    expect(p7).toContain("data-kp-armed");
    expect(p7).toMatch(/key === "x"/);
    const p2 = read("../../src/server/ui/client-parts/part02.ts");
    expect(p2).toContain("data-kp-armed");
    expect(p2.includes("再按 x") || p2.includes("\\u518D\\u6309 x")).toBe(true);
  });
});