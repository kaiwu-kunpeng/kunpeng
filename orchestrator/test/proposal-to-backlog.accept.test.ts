import { describe, expect, it } from "vitest";
import { routeProposal, sweepProposals } from "../src/evolution/proposal-to-backlog.js";

describe("提案自动进升级管道(作者验收)", () => {
  it("依赖漏洞→入队且 requirement 带无损约束", () => {
    const r = routeProposal({ title: "依赖漏洞：vitest（critical）", channel: "security" });
    expect(r.action).toBe("enqueue");
    expect(r.requirement).toContain("vitest");
    expect(r.requirement).toContain("无损");
  });

  it("模块健康需关注→自动驳回为噪声", () => {
    const r = routeProposal({ title: "模块健康：核心研发循环需关注", channel: "module" });
    expect(r.action).toBe("reject");
    expect(r.reason).toContain("噪声");
  });

  it("敏感词→留人工", () => {
    expect(routeProposal({ title: "更新宪法 constitution 条款" }).action).toBe("human");
    expect(routeProposal({ title: "轮换 credential" }).action).toBe("human");
  });

  it("sweep 去重+分流+标记", async () => {
    const marked: [string, string][] = [];
    const enq: string[] = [];
    const out = await sweepProposals({
      listPending: async () => [
        { id: "a1", title: "依赖漏洞：vite（high）", channel: "security" },
        { id: "a2", title: "依赖漏洞：vite（high）", channel: "security" },
        { id: "b1", title: "模块健康：设计/出码需关注", channel: "module" },
        { id: "c1", title: "调整 constitution" },
      ],
      enqueue: async (req) => { enq.push(req); },
      mark: async (id, status) => { marked.push([id, status]); },
    });
    expect(out.enqueued).toBe(1);
    expect(enq.length).toBe(1);
    expect(out.rejected).toBe(1);
    expect(out.human).toBe(1);
    expect(marked.length).toBe(4);
  });
});