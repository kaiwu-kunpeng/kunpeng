import { describe, it, expect } from "vitest";
import {
  classifyFailureMode,
  experiencesToFailureRecords,
  researchableFailureRecords,
  UNCLASSIFIED_FAILURE,
} from "../../src/evolution/experience-failures.js";
import { summarizeFailures } from "../../src/evolution/failure-digest.js";
import { runMaintenanceScan, type MaintenanceScanDeps } from "../../src/evolution/maintenance-scan.js";
import type { Researcher } from "../../src/research/types.js";
import { cliSource } from "../helpers/cli-source.js";

let counter = 0;
const idGen = () => () => `id-${counter++}`;

type ProposalRecord = {
  meta?: {
    proposal?: {
      channel?: string;
    };
  };
};

const expArt = (id: string, outcome: string, evidence: string) => ({
  kind: "experience" as const,
  id,
  status: "draft" as const,
  body: evidence,
  meta: { sourceFlow: id, outcome, evidence },
});

const makeSink = () => {
  const proposals: ProposalRecord[] = [];
  const store = {
    write: async (artifact: ProposalRecord) => {
      proposals.push(artifact);
    },
  } as unknown as MaintenanceScanDeps["store"];
  const captures = { appendCapture: async () => true } as unknown as MaintenanceScanDeps["captures"];
  return {
    proposals,
    store,
    captures,
  };
};

describe("ears 接入 maintain 四通道扫描", () => {
  it("classifyFailureMode：同类失败归同一非空桶（不能用唯一 flow 名）", () => {
    const a = classifyFailureMode("error TS2304: cannot find name 'foo'");
    const b = classifyFailureMode("orchestrator/src/x.ts: error TS1005 ';' expected");
    expect(a).toBe(b);
    expect(a).not.toBe("");
  });

  it("classifyFailureMode：审计/验收门拒绝归「审计/验收缺失」桶（不落兜底）", () => {
    const c = classifyFailureMode("验收测试审计未通过: spec 未给出验收验证命令");
    expect(c).toBe("审计/验收缺失");
    expect(c).not.toBe(UNCLASSIFIED_FAILURE);
  });

  it("experience→FailureRecord：verified 被过滤，复发失败模式产出 directions", () => {
    const recs = experiencesToFailureRecords([
      expArt("flow-a", "rolled-back", "error TS2304 类型红"),
      expArt("flow-b", "rolled-back", "error TS1005 类型红"),
      expArt("flow-c", "verified", "all green"),
    ]);
    const digest = summarizeFailures(recs);
    expect(digest.totalFailures).toBe(2);
    expect(digest.directions.length).toBeGreaterThan(0);
  });

  it("researchableFailureRecords：排除「其它」兜底桶，保留有名失败模式", () => {
    const recs = researchableFailureRecords([
      expArt("flow-a", "rolled-back", "验收测试审计未通过: spec 未给出验收验证命令"),
      expArt("flow-b", "rolled-back", "error TS2304 类型红"),
      expArt("flow-c", "rolled-back", "完全无法分类的随机噪声 zzzqqq"),
      expArt("flow-d", "verified", "all green"),
    ]);
    const cats = recs.map((r) => r.category);
    expect(cats).toContain("审计/验收缺失");
    expect(cats).toContain("类型/tsc");
    expect(cats).not.toContain(UNCLASSIFIED_FAILURE);
  });

  it("scan：有 researcher+failureRecords → 产 ears 通道提案；缺 researcher → 无 ears", async () => {
    const stub: Researcher = {
      research: async (topic) => [
        { topic, source: "https://ref.example", summary: `最佳实践 for ${topic}`, suggestedConvention: "加约束 X" },
      ],
    };
    const failureRecords = async () => [
      { category: "类型/tsc", outcome: "rolled-back", context: "TS2304 a" },
      { category: "类型/tsc", outcome: "rolled-back", context: "TS1005 b" },
    ];

    const withEars = makeSink();
    await runMaintenanceScan({
      store: withEars.store,
      captures: withEars.captures,
      auditJson: async () => "{}",
      moduleStatuses: async () => [],
      now: () => 1,
      id: idGen(),
      researcher: stub,
      failureRecords,
    });
    expect(withEars.proposals.some((p) => p.meta?.proposal?.channel === "ears")).toBe(true);

    const noEars = makeSink();
    await runMaintenanceScan({
      store: noEars.store,
      captures: noEars.captures,
      auditJson: async () => "{}",
      moduleStatuses: async () => [],
      now: () => 1,
      id: idGen(),
    });
    expect(noEars.proposals.some((p) => p.meta?.proposal?.channel === "ears")).toBe(false);
  });

  it("cli.ts：maintain 块用 --research 门控接 researcher 进 runMaintenanceLive", () => {
    const src = cliSource();
    const idx = src.indexOf('name: "maintain"');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 2500);
    expect(block.includes("--research")).toBe(true);
    expect(/researcher/i.test(block)).toBe(true);
  });
});
