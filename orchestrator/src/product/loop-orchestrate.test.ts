// orchestrator/src/product/loop-orchestrate.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { draftSpecForDefinition, acceptAndAdvance, loadLoopView, draftBuildSpec, recordAndClose, applyPivot } from "./loop-orchestrate.js";
import { readBrief, readLoopState, readSpec, readBuildSpec, readValidation, writeBuildSpec, writeLoopState, writeSpec } from "./loop-store.js";
import type { ProductDefinition, ShapedPitch, ProductValidationSignal } from "./contract.js";
import { initState, draftStage, acceptStage } from "./stage-machine.js";
import type { AgentRunner, AgentRequest, AgentResult } from "../agent/runner.js";

const def: ProductDefinition = {
  idea: "研发仪表盘", problem: "看不清健康", users: ["创始人"],
  stories: ["看红灯"], acceptance: ["3秒判读"], nonGoals: ["不做APM"],
};

async function tmpRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kp-orch-"));
}

describe("loop-orchestrate", () => {
  test("draftSpecForDefinition writes spec.md + state(spec:drafted)", async () => {
    const repo = await tmpRepo();
    const slug = await draftSpecForDefinition(repo, def, 1000);
    expect(slug).toBe("研发仪表盘");
    expect((await readSpec(repo, slug))?.includes("研发仪表盘")).toBe(true);
    const st = await readLoopState(repo, slug);
    expect(st?.currentStage).toBe("spec");
    expect(st?.stages.spec.status).toBe("drafted");
  });

  test("acceptAndAdvance(spec) derives brief + state(design:drafted)", async () => {
    const repo = await tmpRepo();
    const slug = await draftSpecForDefinition(repo, def, 1000);
    await acceptAndAdvance(repo, slug, "spec", def, 2000);
    const st = await readLoopState(repo, slug);
    expect(st?.stages.spec.status).toBe("accepted");
    expect(st?.currentStage).toBe("design");
    expect(st?.stages.design.status).toBe("drafted");
    expect((await readBrief(repo, slug))?.projectType).toBe("研发仪表盘");
  });

  test("loadLoopView merges state + spec + brief", async () => {
    const repo = await tmpRepo();
    const slug = await draftSpecForDefinition(repo, def, 1000);
    const view = await loadLoopView(repo, slug);
    expect(view?.currentStage).toBe("spec");
    expect(view?.spec?.includes("研发仪表盘")).toBe(true);
  });
});

class FixedRunner implements AgentRunner {
  constructor(private md: string) {}
  async run() { return { text: JSON.stringify({ buildSpec: this.md }), meta: {} }; }
}

test("draftBuildSpec：读 spec → agent 起草 → 写 build-spec.md + 推进 build:drafted", async () => {
  const repo = await mkdtemp(join(tmpdir(), "p2-orch-"));
  const slug = "dash";
  await writeSpec(repo, slug, "# 产品 spec\nGherkin 场景...");
  let st = initState(slug, "仪表盘", 1);
  st = draftStage(st, "spec", "spec.md", 1);
  st = acceptStage(st, "spec", 1);
  st = draftStage(st, "design", "brief.json", 1);
  st = acceptStage(st, "design", 1); // currentStage → build
  await writeLoopState(repo, st);

  const md = "# 段一：仪表盘\n\n需求\n\n```accept\ntest -f x\n```";
  const next = await draftBuildSpec(repo, slug, new FixedRunner(md), 2);

  expect(next?.currentStage).toBe("build");
  expect(next?.stages.build.status).toBe("drafted");
  expect(await readBuildSpec(repo, slug)).toBe(md);
});

test("loadLoopView 带上 buildSpec", async () => {
  const repo = await mkdtemp(join(tmpdir(), "p2-view-"));
  const slug = "v";
  await writeLoopState(repo, initState(slug, "x", 1));
  await writeBuildSpec(repo, slug, "# 段一\nBS");
  const view = await loadLoopView(repo, slug);
  expect(view?.buildSpec).toContain("BS");
});

test("recordAndClose: 真信号+persevere → validate:accepted + validation.json 落盘", async () => {
  const repo = await mkdtemp(join(tmpdir(), "p3-rac-"));
  const slug = "rac-test";

  // 建立状态机: define→spec→design→build→validate
  let st = initState(slug, "测试产品", 1);
  st = draftStage(st, "spec", "spec.md", 1);
  st = acceptStage(st, "spec", 1);
  st = draftStage(st, "design", "brief.json", 1);
  st = acceptStage(st, "design", 1);
  st = draftStage(st, "build", "build-spec.md", 1);
  st = acceptStage(st, "build", 1); // currentStage → validate
  await writeLoopState(repo, st);

  const pitch: ShapedPitch = {
    title: "测试 pitch",
    appetite: "6 weeks",
    problem: "用户找不到信息",
    solution: "统一搜索入口",
    buildScope: ["搜索框"],
    rabbitHoles: ["AI 推荐"],
    noGos: ["多语言"],
    successMetrics: ["搜索成功率 > 80%"],
  };

  const signals: ProductValidationSignal[] = [
    { source: "用户访谈 A", kind: "interview", summary: "用户明确表示需要此功能", synthetic: false },
  ];

  const result = await recordAndClose(
    repo,
    slug,
    { pitch, hypotheses: ["用户需要搜索功能"], signals, decision: "persevere", rationale: "真实访谈验证" },
    2000,
  );

  expect(result).not.toBeUndefined();
  expect(result?.iteration.action).toBe("build");

  // validation.json 落盘
  const saved = await readValidation(repo, slug);
  expect(saved).not.toBeUndefined();
  expect(saved?.decision).toBe("persevere");
  expect(saved?.signals).toHaveLength(1);

  // 状态机推进到 validate:accepted
  const finalState = await readLoopState(repo, slug);
  expect(finalState?.stages.validate.status).toBe("accepted");
});

/** 按调用顺序返回不同结果的 runner */
class CountedRunner implements AgentRunner {
  private callCount = 0;
  constructor(private responses: AgentResult[]) {}
  async run(_req: AgentRequest): Promise<AgentResult> {
    const idx = this.callCount++;
    const r = this.responses[idx];
    if (!r) throw new Error(`CountedRunner: no response for call #${idx}`);
    return r;
  }
}

test("applyPivot: nextSeed 重生 build-spec 并拨回 build:drafted", async () => {
  const repo = await mkdtemp(join(tmpdir(), "p3-pivot-"));
  const slug = "pivot-test";

  // 初始状态(任意，validate 阶段)
  let st = initState(slug, "旧产品", 1);
  st = draftStage(st, "spec", "spec.md", 1);
  st = acceptStage(st, "spec", 1);
  st = draftStage(st, "design", "brief.json", 1);
  st = acceptStage(st, "design", 1);
  st = draftStage(st, "build", "build-spec.md", 1);
  st = acceptStage(st, "build", 1); // currentStage → validate
  await writeLoopState(repo, st);

  // 第1次调用: autoDefineProduct (stage: "spec") → 返回 ProductDefinition JSON (无 idea 字段)
  const defJson = JSON.stringify({
    problem: "用户无法快速找到想要的产品",
    jobStatement: "当用户浏览时想快速定位商品以便下单",
    users: ["电商买家"],
    stories: ["一键搜索"],
    acceptance: ["搜索结果 < 1s"],
    nonGoals: ["不做推荐算法"],
  });

  // 第2次调用: specToBuildSpec (stage: "spec") → 返回 {buildSpec: markdown}
  const buildSpecMd = "# 段一：转向新产品\n\n新 build-spec 内容\n\n```accept\ntest -f x\n```";
  const buildSpecJson = JSON.stringify({ buildSpec: buildSpecMd });

  const runner = new CountedRunner([
    { text: defJson, meta: {} },
    { text: buildSpecJson, meta: {} },
  ]);

  const next = await applyPivot(repo, slug, "新产品方向", runner, 3000);

  expect(next).not.toBeUndefined();
  expect(next?.currentStage).toBe("build");
  expect(next?.stages.build.status).toBe("drafted");

  // build-spec.md 落盘内容正确
  const savedBuildSpec = await readBuildSpec(repo, slug);
  expect(savedBuildSpec).toContain("转向新产品");
});
