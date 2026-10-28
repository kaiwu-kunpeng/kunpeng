import { describe, it, expect } from "vitest";
import { renderProjectOps } from "../../src/server/ui/views/project.js";
import { clientScript } from "../../src/server/ui/client.js";

const DAY = 86_400_000;

function playbook(over: Record<string, unknown>) {
  return { id: "pb", title: "动作", gate: "review", sections: {}, body: "", ...over };
}

describe("运营 tab 跑一波按钮", () => {
  it("到期且有 loopId → 按钮带 loopId 与 projectId", () => {
    const html = renderProjectOps({
      playbooks: [playbook({ id: "a", title: "到期卡", cadence: "weekly", loopId: "loop-a" }) as never],
      loops: [],
    }, { now: 10 * DAY, projectId: "proj-x" });
    expect(html).toContain('data-ops-run="loop-a"');
    expect(html).toContain('data-project="proj-x"');
    expect(html).toContain("跑一波");
  });

  it("未到期/未接 loop → 无按钮", () => {
    const now = 10 * DAY;
    const html = renderProjectOps({
      playbooks: [
        playbook({ id: "b", title: "新鲜卡", cadence: "weekly", loopId: "l-fresh" }) as never,
        playbook({ id: "c", title: "没接卡" }) as never,
      ],
      loops: [{ id: "l-fresh", waves: [{ at: now - DAY }] }] as never,
    }, { now, projectId: "proj-x" });
    expect(html).not.toContain("data-ops-run");
  });

  it("client 接线:按钮打 /api/ops/run 且模板串安全", () => {
    expect(clientScript).toContain("data-ops-run");
    expect(clientScript).toContain('"/api/ops/run"');
    expect(clientScript.includes("`")).toBe(false);
  });
});