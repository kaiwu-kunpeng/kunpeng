import { describe, it, expect } from "vitest";
import { landApprovedChannelProposals, isChannelProposalWithoutChanges } from "../../src/evolution/landing.js";

function proposal(id: string, status: string, channel?: string, changes?: unknown[]): { id: string; status: string; body?: string; meta?: unknown } {
  return {
    id,
    status,
    body: `# 提案 ${id}\n\n详情内容`,
    meta: channel ? { proposal: { channel, title: `标题-${id}`, ...(changes !== undefined ? { changes } : {}) } } : {},
  };
}

describe("isChannelProposalWithoutChanges", () => {
  it("有 channel 无 changes → true；changes 非空 → false", () => {
    expect(isChannelProposalWithoutChanges(proposal("a", "approved", "module"))).toBe(true);
    expect(isChannelProposalWithoutChanges(proposal("b", "approved", "module", []))).toBe(true);
    expect(isChannelProposalWithoutChanges(proposal("c", "approved", "module", [{ target: "x" }]))).toBe(false);
    expect(isChannelProposalWithoutChanges({ meta: {} })).toBe(false);
  });
});

describe("landApprovedChannelProposals", () => {
  it("approved 无 changes 的四通道提案转任务并推进 verified；带 changes 的 skip；非 approved 忽略", async () => {
    const created: Array<Record<string, unknown>> = [];
    const transitions: Array<[string, string]> = [];
    const report = await landApprovedChannelProposals(
      [
        proposal("p1", "approved", "security"),
        proposal("p2", "approved", "module", [{ target: "y" }]),
        proposal("p3", "draft", "ears"),
        proposal("p4", "approved", "ears"),
      ],
      {
        createTask: async (t) => { created.push(t as Record<string, unknown>); return { id: `task-${created.length}` }; },
        transition: async (id, to) => { transitions.push([id, to]); },
        projectId: "kunpeng",
      },
    );

    expect(report.landed.map((l) => l.proposalId)).toEqual(["p1", "p4"]);
    expect(report.skipped).toEqual([{ proposalId: "p2", reason: "has-changes" }]);

    expect(created).toHaveLength(2);
    const sec = created[0];
    expect(sec.type).toBe("security-fix");
    expect(sec.status).toBe("ready");
    expect(sec.projectId).toBe("kunpeng");
    expect(sec.title).toBe("标题-p1");
    expect(Array.isArray(sec.acceptanceCriteria)).toBe(true);
    expect((sec.acceptanceCriteria as string[]).join("\n")).toContain("p1");
    expect((sec.acceptanceCriteria as string[]).join("\n")).toContain("npm audit");
    expect(created[1].type).toBe("research-adopt");

    expect(transitions).toEqual([
      ["p1", "in-progress"],
      ["p1", "verified"],
      ["p4", "in-progress"],
      ["p4", "verified"],
    ]);
  });

  it("createTask 抛错单条进 skipped，不拖垮整批；transition 抛错不影响 landed", async () => {
    let calls = 0;
    const report = await landApprovedChannelProposals(
      [proposal("bad", "approved", "module"), proposal("good", "approved", "official")],
      {
        createTask: async () => {
          calls += 1;
          if (calls === 1) throw new Error("boom-create");
          return { id: "task-ok" };
        },
        transition: async () => { throw new Error("boom-transition"); },
      },
    );
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].proposalId).toBe("bad");
    expect(report.skipped[0].reason).toContain("boom-create");
    expect(report.landed).toEqual([{ proposalId: "good", taskId: "task-ok", channel: "official" }]);
  });
});