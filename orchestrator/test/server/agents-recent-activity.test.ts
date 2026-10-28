import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatHeartbeatAge,
  renderAgentsPresentPanel,
  summarizeRecentAgents,
} from "../../src/server/ui/views/overview.js";

const MIN = 60_000;
const HOUR = 3_600_000;

describe("formatHeartbeatAge", () => {
  it("一分钟内算刚刚", () => {
    expect(formatHeartbeatAge(0)).toBe("刚刚");
    expect(formatHeartbeatAge(59_999)).toBe("刚刚");
  });

  it("分钟档与小时档", () => {
    expect(formatHeartbeatAge(3 * MIN)).toBe("3 分钟前");
    expect(formatHeartbeatAge(59 * MIN)).toBe("59 分钟前");
    expect(formatHeartbeatAge(2 * HOUR)).toBe("2 小时前");
    expect(formatHeartbeatAge(25 * HOUR)).toBe("25 小时前");
  });

  it("负数与非法值一律刚刚,不抛错", () => {
    expect(formatHeartbeatAge(-1)).toBe("刚刚");
    expect(formatHeartbeatAge(Number.NaN)).toBe("刚刚");
    expect(formatHeartbeatAge(Number.POSITIVE_INFINITY)).toBe("刚刚");
  });
});

describe("summarizeRecentAgents", () => {
  const now = 1_000_000_000;

  it("按项目分组,count 是全部条数,lastAgeMs 取最新那条", () => {
    const out = summarizeRecentAgents([
      { instance: "a1", projectId: "proj-alpha", ts: now - 5 * MIN },
      { instance: "a2", projectId: "proj-alpha", ts: now - 2 * MIN },
      { instance: "b1", projectId: "proj-beta", ts: now - 9 * MIN },
    ], now);
    expect(out).toHaveLength(2);
    expect(out[0]?.projectId).toBe("proj-alpha");
    expect(out[0]?.count).toBe(2);
    expect(out[0]?.lastAgeMs).toBe(2 * MIN);
    expect(out[1]?.projectId).toBe("proj-beta");
    expect(out[1]?.count).toBe(1);
  });

  it("分组按最近活跃升序排(最新的项目在前)", () => {
    const out = summarizeRecentAgents([
      { instance: "old", projectId: "proj-old", ts: now - 20 * MIN },
      { instance: "new", projectId: "proj-new", ts: now - 1 * MIN },
    ], now);
    expect(out.map((g) => g.projectId)).toEqual(["proj-new", "proj-old"]);
  });

  it("缺 projectId 归到「未归属项目」", () => {
    const out = summarizeRecentAgents([
      { instance: "x", ts: now - MIN },
      { instance: "y", projectId: "   ", ts: now - MIN },
    ], now);
    expect(out).toHaveLength(1);
    expect(out[0]?.projectId).toBe("未归属项目");
    expect(out[0]?.count).toBe(2);
  });

  it("每组截断到 maxPerProject,shown 降序,hiddenCount 正确", () => {
    const agents = Array.from({ length: 10 }, (_, i) => ({
      instance: `cc-${i}`,
      projectId: "proj-alpha",
      ts: now - (i + 1) * MIN,
    }));
    const out = summarizeRecentAgents(agents, now, 5);
    expect(out[0]?.count).toBe(10);
    expect(out[0]?.shown).toHaveLength(5);
    expect(out[0]?.hiddenCount).toBe(5);
    expect(out[0]?.shown.map((s) => s.instance)).toEqual(["cc-0", "cc-1", "cc-2", "cc-3", "cc-4"]);
    expect(out[0]?.shown[0]?.ageMs).toBe(MIN);
  });

  it("时间戳比 now 还新时 ageMs 取 0,不出负数", () => {
    const out = summarizeRecentAgents([{ instance: "future", projectId: "p", ts: now + 5 * MIN }], now);
    expect(out[0]?.lastAgeMs).toBe(0);
    expect(out[0]?.shown[0]?.ageMs).toBe(0);
  });

  it("空输入与非法 now 都不抛错", () => {
    expect(summarizeRecentAgents([], now)).toEqual([]);
    const out = summarizeRecentAgents([{ instance: "a", projectId: "p", ts: now }], Number.NaN);
    expect(out[0]?.lastAgeMs).toBe(0);
  });
});

describe("renderAgentsPresentPanel 措辞不许谎报并发数", () => {
  const now = 1_000_000_000;

  it("线上真实形状:同项目 10 条一次性登记 → 说「10 次登记」,绝不出现「在场」", () => {
    const agents = Array.from({ length: 10 }, (_, i) => ({
      instance: `cc-proj1-${1000 + i}`,
      projectId: "proj-alpha",
      task: "Claude Code 交互会话",
      ts: now - (i + 3) * MIN,
    }));
    const html = renderAgentsPresentPanel(agents, now);
    expect(html).toContain("10 次登记");
    expect(html).toContain("3 分钟前");
    expect(html).not.toContain("在场");
    expect(html).toContain('data-panel="agents-present"');
    expect(html).toContain("…另 5 条");
  });

  it("空列表说「最近 30 分钟无 agent 活动」", () => {
    const html = renderAgentsPresentPanel([], now);
    expect(html).toContain("最近 30 分钟无 agent 活动");
    expect(html).not.toContain("无在场 agent");
  });

  it("面板标题与 hint 已改成最近活跃口径", () => {
    const html = renderAgentsPresentPanel([], now);
    expect(html).toContain("最近活跃 Agent");
    expect(html).toContain("一次性登记");
  });
});

describe("窗口口径", () => {
  it("collectAgentsPresent 显式用 30 分钟窗口", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/server/state-collect/dashboard.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(/isOnline\(\s*heartbeat\.ts\s*,\s*now\s*,\s*30\s*\*\s*60_000\s*\)/);
  });

  it("isOnline 的默认窗口仍是 60_000(不许动,别的调用方靠它)", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/switchboard/presence.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("windowMs = 60_000");
  });
});