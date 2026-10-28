// 产品 spec（PR/FAQ + Gherkin）→ kunpeng plan/run 能吃的「可构建 spec」。
// agent 起草（Gherkin→可执行 accept 需推理），返回 {"buildSpec": markdown}；纯函数边界：无 IO、不调 plan。
import type { AgentRunner } from "../agent/runner.js";
import { extractFirstJsonObject } from "../util/extract-json.js";

const PARSE_ERROR = "specToBuildSpec: agent 未返回可解析的 {buildSpec} JSON";

export function buildSpecPrompt(spec: string): string {
  return [
    "你是资深工程师。把下面的产品 spec（PR/FAQ + Gherkin 场景）改写成鲲鹏 `kunpeng plan` 能拆解、`kunpeng run` 能验证的「可构建 spec」（markdown）。",
    "硬性格式要求（违反则 plan 管线静默失效）：",
    "1. 单 H1 分段：整篇一个 `# 段一：<标题>`，段内只用普通文本，不要用 `##` 子标题（`##` 会被拆成多个无验收的 flow）。",
    "2. 每段末尾给一个 ```scope 块，块内每行写 `allow: <单个 glob>`（不要 YAML 列表写法，会被静默解析成空）。",
    "3. 每段末尾给一个 ```accept 块，块内是可执行的红绿验收命令（test -f / grep / npx vitest run <测试>），必须硬断言新产物存在，不要写 echo 占位。",
    "4. 产品是独立小仓：scope 块与所有文件路径一律写产品仓内相对路径（如 `src/**`、`index.html`、`test/**`），绝不写宿主项目路径，不得出现 `orchestrator/` 或 `products/` 前缀。",
    "诚实要求：原 Gherkin 可能引用并不存在的接口/符号，你只需忠实改写成可构建 spec，技术细节由人随后精修，别自己编造未给出的实现。",
    "只输出 JSON：{\"buildSpec\": \"<完整 markdown 字符串>\"}，不要任何额外文字。",
    "",
    "=== 产品 spec 原文 ===",
    spec,
  ].join("\n");
}

export async function specToBuildSpec(
  spec: string,
  runner: AgentRunner,
  opts?: { conventions?: string },
): Promise<string> {
  const system = opts?.conventions?.trim() ? opts.conventions : "";
  const out = await runner.run({ stage: "spec", system, input: buildSpecPrompt(spec), tools: [] });
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractFirstJsonObject(out.text));
  } catch {
    throw new Error(PARSE_ERROR);
  }
  const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  if (typeof obj.buildSpec !== "string" || !obj.buildSpec.trim()) throw new Error(PARSE_ERROR);
  return obj.buildSpec;
}
