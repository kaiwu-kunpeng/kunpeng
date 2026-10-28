import { writeFile, mkdir, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { CliRunner } from "../agent/cli-runner.js";
import { nextAdrNumber, adrFilename, renderFilledAdr } from "../dossier/adr.js";
import { runProductCommand } from "../product/cli.js";
import { closeValidationLoop, validationAdrSections } from "../product/loop-close.js";
import { runProductDiscover, runProductShape, runProductValidate } from "../product/pipeline.js";
import { buildProductPlan } from "../product/plan.js";
import { readShapedPitch } from "../product/store.js";
import { registerCliCommand, type CliContext } from "./registry.js";

registerCliCommand({
  name: "product",
  run: async (context: CliContext) => {
    const sub = context.rest[0];

    // 子命令：聚合并查看整份项目方案（无需 runner）
    if (sub === "plan") {
      const plan = await buildProductPlan(context.repoRoot);
      const planPath = join(context.repoRoot, ".kunpeng", "product", "plan.json");
      await mkdir(dirname(planPath), { recursive: true });
      await writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
      if (!plan.definition) {
        console.log('[产品·PLAN] 尚无产品定义：请先运行 kunpeng product "<想法>"');
      } else {
        console.log(`[产品·PLAN] ${plan.definition.problem}`);
        if (plan.storyMap) {
          const hi = plan.storyMap.risks.filter((r) => r.severity === "high").length;
          console.log(
            `  backbone: ${plan.storyMap.backbone.length} 活动｜走骨架任务: ${plan.storyMap.slices[0]?.tasks.length ?? 0}｜里程碑: ${plan.storyMap.milestones.length}｜风险: ${plan.storyMap.risks.length}（高危 ${hi}）`,
          );
        }
        if (plan.forecast) {
          console.log(
            `  估算(每任务默认8h·蒙特卡洛): p50 ${plan.forecast.p50}h｜p80 ${plan.forecast.p80}h｜p95 ${plan.forecast.p95}h（${plan.forecast.calibrated ? "已历史校准" : "默认谱·未校准"}）`,
          );
        }
        if (plan.gate) {
          console.log(`  门: ${plan.gate.blocked ? "🚫 拦截" : plan.gate.requiresHumanReview ? "🟡 待复核" : "✅ 通过"}`);
        }
        if (plan.nextIteration) console.log(`  下一步: ${plan.nextIteration.action}`);
      }
      console.log(`  方案数据：${planPath}`);
      return;
    }

    // 子命令：推进产品周期阶段（DEFINE 之后）
    if (sub === "discover" || sub === "shape" || sub === "validate") {
      const runner = new CliRunner();
      if (sub === "discover") {
        const d = await runProductDiscover(context.repoRoot, runner);
        console.log(`[产品·DISCOVER] jobStatement: ${d.jobStatement}`);
        console.log(
          `  目标用户: ${d.targetUsers.join(", ") || "(无)"}｜机会 ${d.opportunities.length} 个｜${
            d.syntheticEvidence ? "⚠️ 合成证据(需真实访谈验证)" : "真实证据"
          }`,
        );
      } else if (sub === "shape") {
        const p = await runProductShape(context.repoRoot, runner);
        console.log(`[产品·SHAPE] ${p.title}｜appetite: ${p.appetite}`);
        console.log(
          `  构建范围 ${p.buildScope.length}｜兔子洞 ${p.rabbitHoles.length}｜不做 ${p.noGos.length}｜成功指标 ${p.successMetrics.length}`,
        );
      } else {
        const hypotheses = context.rest.reduce<string[]>((acc, t, i) => {
          if (t === "--hypothesis" && context.rest[i + 1]) acc.push(context.rest[i + 1]);
          return acc;
        }, []);
        const v = await runProductValidate(context.repoRoot, { hypotheses, signals: [] });
        console.log(`[产品·VALIDATE] 裁定: ${v.decision}（需人工门: ${v.requiresHumanGate ? "是" : "否"}）`);
        console.log(`  ${v.rationale}`);
        const pitch = await readShapedPitch(context.repoRoot);
        if (pitch) {
          const iter = closeValidationLoop(v, pitch);
          console.log(`  ↳ 下一步: ${iter.action}${iter.nextSeed ? `（种子: ${iter.nextSeed}）` : ""}`);
          console.log(`     ${iter.rationale}`);
          const iterPath = join(context.repoRoot, ".kunpeng", "product", "next-iteration.json");
          await mkdir(dirname(iterPath), { recursive: true });
          await writeFile(iterPath, JSON.stringify(iter, null, 2), "utf8");
          console.log(`     已写下一轮建议：${iterPath}`);
          const adrSections = validationAdrSections(v, iter, pitch);
          if (adrSections) {
            const decDir = join(context.repoRoot, "docs", "decisions");
            await mkdir(decDir, { recursive: true });
            const decFiles = await readdir(decDir).catch((): string[] => []);
            const decNum = nextAdrNumber(decFiles);
            const decDate = new Date().toISOString().slice(0, 10);
            const decName = adrFilename(decNum, adrSections.title);
            await writeFile(
              join(decDir, decName),
              renderFilledAdr(decNum, adrSections.title, { status: adrSections.status, dateISO: decDate }, adrSections),
              "utf8",
            );
            console.log(`     已记决策日志 ADR-${decNum}：${join(decDir, decName)}`);
          }
        }
        console.log("  提示: 真实信号(遥测/访谈/销售)接入后方可裁定 pivot/persevere；当前无真实信号→inconclusive。");
      }
      return;
    }

    const idea = context.rest.join(" ").trim();
    if (!idea) {
      console.error('用法: kunpeng product "<一句话产品想法>" | product discover|shape|validate|plan [--repo <仓库>]');
      process.exit(1);
    }

    const runner = new CliRunner();
    console.log(`[产品] 一句话 DEFINE → PR FAQ（后端 ${runner.backend}）`);
    const result = await runProductCommand({ repoRoot: context.repoRoot, idea, runner });
    console.log(`[产品] 已生成产品定义与 spec 草稿：${result.draftSpecPath}`);
    console.log(`  产品 slug：${result.slug}`);
    console.log(`  problem: ${result.definition.problem}`);
    if (result.definition.users.length) console.log(`  users: ${result.definition.users.join(", ")}`);
    if (result.definition.stories.length) console.log(`  stories: ${result.definition.stories.length} 条`);
    if (result.definition.acceptance.length) console.log(`  acceptance: ${result.definition.acceptance.length} 条`);
    if (result.gate.blocked) {
      console.log(
        `  🚫 门已拦截（具体性 ${result.gate.concreteness.score} 分 / 红队 ${result.gate.critique.verdict}）——需人工补全后方可进入开发`,
      );
    } else if (result.gate.requiresHumanReview) {
      console.log(`  🟡 门：建议人工复核（红队 ${result.gate.critique.verdict}）`);
    } else {
      console.log("  ✅ 门：通过");
    }
    console.log(`  门详情：${result.gatePath}`);
    return;
  },
});
