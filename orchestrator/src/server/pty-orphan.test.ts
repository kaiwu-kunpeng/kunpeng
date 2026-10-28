import { describe, expect, it } from "vitest";

import { planPtyOrphanSweep } from "./pty-orphan.js";

const DAY = 24 * 3600 * 1000;
const now = 100 * DAY;

describe("pty 孤儿/僵尸清扫决策", () => {
  it("registry 无记录的 kpt-pty tmux 会话 → 杀", () => {
    const plan = planPtyOrphanSweep({
      tmuxSessions: [{ name: "kpt-pty-1-1", activityAt: now }],
      registry: {},
      now,
    });
    expect(plan.killTmux).toEqual(["kpt-pty-1-1"]);
  });

  it("非 kpt-pty 前缀的 tmux 会话绝不碰", () => {
    const plan = planPtyOrphanSweep({
      tmuxSessions: [{ name: "main", activityAt: 0 }, { name: "kpt-other", activityAt: 0 }],
      registry: {},
      now,
    });
    expect(plan.killTmux).toEqual([]);
  });

  it("闲置超 TTL → 杀并删登记;活跃保留", () => {
    const plan = planPtyOrphanSweep({
      tmuxSessions: [
        { name: "kpt-pty-old-1", activityAt: now - 8 * DAY },
        { name: "kpt-pty-new-1", activityAt: now - 1 * DAY },
      ],
      registry: { "pty-old-1": { createdAt: 0 }, "pty-new-1": { createdAt: 0 } },
      now,
    });
    expect(plan.killTmux).toEqual(["kpt-pty-old-1"]);
    expect(plan.dropRegistry).toContain("pty-old-1");
    expect(plan.dropRegistry).not.toContain("pty-new-1");
  });

  it("tmux 已死的登记项 → 删登记不杀", () => {
    const plan = planPtyOrphanSweep({
      tmuxSessions: [],
      registry: { "pty-dead-1": { createdAt: 0 } },
      now,
    });
    expect(plan.dropRegistry).toEqual(["pty-dead-1"]);
    expect(plan.killTmux).toEqual([]);
  });
});