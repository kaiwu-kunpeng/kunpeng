import { describe, it, expect, vi } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, userInfo: () => ({ ...actual.userInfo(), username: "tester" }) };
});

const { renderSidebar } = await import("../../src/server/ui/sidebar.js");
import type { DashboardState } from "../../src/server/state.js";

function stateWith(): DashboardState {
  return { humanGates: [], flows: [], artifacts: {} } as unknown as DashboardState;
}

describe("侧栏用户名去个人化", () => {
  it("rail-foot 显示当前系统用户名与其首字母头像,无硬编码人名", () => {
    const html = renderSidebar(stateWith(), "overview");
    expect(html).toContain(">tester<");
    expect(html).toContain(">T<");
    expect(html.includes("admin")).toBe(false);
  });
});