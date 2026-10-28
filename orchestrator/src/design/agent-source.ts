// Agent 设计来源 agent-source —— 经后端 agent 把「方案 + 风格简报」解析为 DesignContract。
// House 是确定性兜底；本来源是「方案自带设计 / 抽取设计意图」时的外部适配层：
// 调 runner（claude/codex 等后端）产出契约 JSON，再委托 parseDesignContract 防御式解析。
// 跨模块仅 import type contract（C1：contract.ts 由阶段一独占，不得重建）。
// 解析复用 parse-contract（C8：确定性手段判定，不重建）；只传最小工具集（C7）。
import type {
  DesignSource,
  DesignSourceInput,
  DesignContract,
  DesignCandidate,
} from "./contract.js";
import type { AgentRunner } from "../agent/runner.js";
import { parseDesignContract } from "./parse-contract.js";

/** 构造 AgentDesignSource 所需的最小依赖。 */
export interface AgentDesignSourceOptions {
  /** 来源名称（= DesignSource.name），也作契约缺 source 时的兜底标识。 */
  name: string;
  /** 后端 agent 运行器（注入，便于测试用 FakeRunner 替身）。 */
  runner: AgentRunner;
  /** 风格简报：设计意图/锚点的一句话描述，进提示，且作降级契约的 anchor。 */
  styleBrief: string;
  /** 本来源解析所需的最小工具集（C7）。省略即空，传给 runner。 */
  tools?: string[];
}

/**
 * Agent 设计来源：把「方案 Markdown + 风格简报」交给后端 agent，产出 DesignContract。
 *
 * 满足 contract 的 `DesignSource` 接口（`name` + 异步 `resolve`）。解析委托
 * `parseDesignContract`；任何不可信/不合规返回一律安全降级为最小契约，绝不抛错（C6 防投毒）。
 */
export class AgentDesignSource implements DesignSource {
  /** DesignSource.name —— 直接透传 opts.name。 */
  readonly name: string;
  private readonly runner: AgentRunner;
  private readonly styleBrief: string;
  private readonly tools: string[];

  constructor(opts: AgentDesignSourceOptions) {
    this.name = opts.name;
    this.runner = opts.runner;
    this.styleBrief = opts.styleBrief;
    this.tools = opts.tools ?? [];
  }

  /**
   * 解析为候选契约：以 `stage:"design"`、最小工具集、内嵌方案与风格简报的提示调 runner，
   * 再防御式解析其返回文本。解析成功取契约（缺 source 兜底为 name）；失败回最小契约。
   */
  async resolve(input: DesignSourceInput): Promise<DesignCandidate> {
    const planMd = input.planMd ?? "";
    const result = await this.runner.run({
      stage: "design",
      system: "",
      input: this.buildPrompt(planMd),
      tools: this.tools,
    });

    const contract = parseDesignContract(result.text, this.name);
    if (contract === null) {
      const fallback = this.minimalContract();
      return { source: fallback.source, contract: fallback };
    }
    return { source: contract.source, contract };
  }

  /** 拼解析提示：内嵌风格简报与方案 Markdown，要求只输出契约 JSON 本身。 */
  private buildPrompt(planMd: string): string {
    return (
      `按风格简报「${this.styleBrief}」与下方方案，产出一份 DesignContract JSON：` +
      `含 source / anchor / tokens(colors,spacing,typography) / components。` +
      `只输出 JSON 本身，不要解释或 markdown 包裹。\n\n方案：\n${planMd}`
    );
  }

  /** 降级契约：解析失败时的最小可用契约（anchor 取风格简报，其余置空）。 */
  private minimalContract(): DesignContract {
    return {
      source: this.name,
      anchor: this.styleBrief,
      tokens: { colors: {}, spacing: {}, typography: {} },
      components: [],
    };
  }
}
