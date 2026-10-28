import { describe, expect, it } from "vitest";
import {
  markProposalRoute,
  pendingFromArtifact,
  routeProposal,
  sweepProposals,
} from "../src/evolution/proposal-to-backlog.js";

const patrolBody = "# 进化提案（需人工批准后应用 — 人工门 #2）\n- [conventions] 据 https://x 调研：把 constitution 与 凭证 隔离";

describe("巡研提案门控(作者验收)", () => {
  it("patrol- 提案无评测证据→自动驳回,不进人工门", () => {
    const r = routeProposal({ id: "patrol-a1", title: "进化提案", body: patrolBody, changeCount: 3 });
    expect(r.action).toBe("reject");
    expect(r.reason).toContain("Δ");
  });

  it("patrol- 提案 Δ=0→自动驳回,reason 带差值", () => {
    const r = routeProposal({
      id: "patrol-a2",
      title: "进化提案",
      body: patrolBody,
      changeCount: 3,
      evidence: { holdoutPassK: 0.6733, baseline: { holdoutPassK: 0.6733 } },
    });
    expect(r.action).toBe("reject");
    expect(r.reason).toContain("Δ");
    expect(r.reason).toMatch(/0(\.0+)?/);
  });

  it("patrol- 提案 Δ>0 但超过 5 条→自动驳回,reason 提到上限 5", () => {
    const r = routeProposal({
      id: "patrol-a3",
      title: "进化提案",
      body: patrolBody,
      changeCount: 6,
      evidence: { holdoutPassK: 0.7, baseline: { holdoutPassK: 0.67 } },
    });
    expect(r.action).toBe("reject");
    expect(r.reason).toContain("5");
  });

  it("patrol- 提案 Δ>0 且 ≤5 条→放行到既有规则(敏感词留人工)", () => {
    const r = routeProposal({
      id: "patrol-a4",
      title: "进化提案",
      body: patrolBody,
      changeCount: 5,
      evidence: { holdoutPassK: 0.7, baseline: { holdoutPassK: 0.67 } },
    });
    expect(r.action).toBe("human");
    expect(r.reason).toContain("敏感词");
  });

  it("非 patrol- 提案不受门控影响", () => {
    expect(routeProposal({ id: "evolve-1", title: "调整 constitution", changeCount: 20 }).action).toBe("human");
    expect(routeProposal({ title: "模块健康：核心研发循环需关注", changeCount: 20 }).action).toBe("reject");
  });

  it("pendingFromArtifact 提取 changeCount 与 evidence,title 兜底到正文标题", () => {
    const p = pendingFromArtifact({
      id: "patrol-x",
      body: "\n# 标题行\n正文",
      status: "draft",
      meta: {
        proposal: {
          changes: [{ target: "conventions", text: "a", source: "e1" }, { target: "conventions", text: "b", source: "e1" }],
          evidence: { holdoutPassK: 0.5, costPerResolvedTask: 1, baseline: { holdoutPassK: 0.4 } },
        },
      },
    });
    expect(p.id).toBe("patrol-x");
    expect(p.title).toBe("标题行");
    expect(p.changeCount).toBe(2);
    expect(p.evidence?.holdoutPassK).toBe(0.5);
    expect(p.evidence?.baseline?.holdoutPassK).toBe(0.4);

    const q = pendingFromArtifact({ id: "p-y", body: "", status: "draft", meta: {} });
    expect(q.title).toBe("p-y");
    expect(q.changeCount).toBe(0);
    expect(q.evidence).toBeUndefined();
  });

  it("markProposalRoute: auto-rejected 且产物仍 draft→转 rolled-back;其余只写 meta", async () => {
    const log: string[] = [];
    const store = {
      read: async (id: string) => ({ id, status: id === "d1" ? "draft" : "verified" }),
      patchMeta: async (id: string, meta: Record<string, unknown>) => { log.push(`meta:${id}:${String(meta.status)}`); },
      transition: async (id: string, to: string) => { log.push(`tx:${id}:${to}`); },
    };
    await markProposalRoute(store, "d1", "auto-rejected", "r");
    await markProposalRoute(store, "v1", "auto-rejected", "r");
    await markProposalRoute(store, "d1", "human-review", "r");
    expect(log).toEqual([
      "meta:d1:auto-rejected",
      "tx:d1:rolled-back",
      "meta:v1:auto-rejected",
      "meta:d1:human-review",
    ]);
  });

  it("sweep 里 Δ=0 的 patrol 提案计入 rejected 并 mark auto-rejected", async () => {
    const marked: [string, string][] = [];
    const out = await sweepProposals({
      listPending: async () => [
        { id: "patrol-s1", title: "进化提案", body: patrolBody, changeCount: 15, evidence: { holdoutPassK: 0.67, baseline: { holdoutPassK: 0.67 } } },
      ],
      enqueue: async () => {},
      mark: async (id, status) => { marked.push([id, status]); },
    });
    expect(out.rejected).toBe(1);
    expect(out.human).toBe(0);
    expect(marked).toEqual([["patrol-s1", "auto-rejected"]]);
  });
});