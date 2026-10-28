import type { Researcher, ResearchFinding } from "./types.js";
import type { AgentRunner } from "../agent/runner.js";
import { extractFirstJsonArray } from "../util/extract-json.js";
import { parsePrediction, PREDICTION_METRICS } from "../evolution/prediction.js";

/** 调后端 agent 上网调研一个 topic，把返回的 JSON 解析成 ResearchFinding[]。 */
export class AgentResearcher implements Researcher {
  constructor(private runner: AgentRunner) {}

  async research(topic: string): Promise<ResearchFinding[]> {
    const result = await this.runner.run({
      stage: "spec",
      system: "",
      // 保留 stage:"spec" 但用 instructionOverride 顶掉「写 spec」角色指令：本次是联网调研、不是产出 spec。
      instructionOverride:
        `本次任务是【联网调研】，不是产出 spec。用 web 检索最新公开资料，` +
        `把结论整理成 ResearchFinding 的 JSON 数组返回。` +
        `不要输出验收标准、不要写规格书、不要输出任何测试命令行。`,
      input:
        `上网调研主题「${topic}」，把结论整理成 ResearchFinding 数组。` +
        `每条含 topic / source(可信 http 来源 url) / summary，可选 suggestedConvention。` +
        `凡给出 suggestedConvention 或 suggestedUpgrade，必须同时给 prediction 对象，声明采纳后可证伪的效果：` +
        `{"metric": ${PREDICTION_METRICS.map((m) => `"${m}"`).join(" | ")}, "direction": "up" | "down", "minDelta": 正数, "windowDays": 1-60 的整数}。` +
        `metric 含义：verifiedRate=真实流通过率(0-1)，rollbackTokenShare=回滚流 token 占比(0-1)，tokensPerVerified=每条 verified 流消耗 token。` +
        `只输出 JSON 数组本身，不要任何解释或 markdown 包裹。`,
      tools: ["websearch"],
    });

    // 后端常吐 JSON 数组 + 前后 prose/banner 噪声（如 "tokens used" 尾巴）→ 裸 JSON.parse 会失败。
    // 先字符串感知地抠出第一个完整数组再 parse；纯 JSON 时退化为直接 parse。
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractFirstJsonArray(result.text));
    } catch {
      try { parsed = JSON.parse(result.text); } catch { return []; }
    }
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item): item is ResearchFinding =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).topic === "string" &&
          typeof (item as Record<string, unknown>).source === "string" &&
          typeof (item as Record<string, unknown>).summary === "string",
      )
      .map((item) => {
        // 预测不合格就丢掉该字段（不编造），其余字段原样保留。
        const { prediction: rawPrediction, ...rest } = item as ResearchFinding & { prediction?: unknown };
        const prediction = parsePrediction(rawPrediction);
        return prediction ? { ...rest, prediction } : rest;
      });
  }
}
