// 防御式解析 parse-contract —— 把 agent 返回文本安全降级为 DesignContract | null。
// 本文件无副作用：不读 IO、不调 LLM、无顶层执行逻辑（C8 确定性优先）。
// 对齐 AgentResearcher 的防御式风格，防 indirect prompt injection 投毒（宪法 C6）。

import type { DesignContract } from "./contract.js";

/** 取 obj[key]：其值为对象（非 null / 非数组）则原样返回，否则返回空对象。 */
function asRecord(value: unknown): Record<string, string> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, string>;
  }
  return {};
}

/**
 * 纯函数：把 agent 返回的文本（应为 JSON）防御式地解析为 DesignContract。
 * 任何不可信 / 不合规输入一律安全降级为 `null`，绝不抛异常。
 *
 * @param text 待解析文本（应为契约 JSON）。
 * @param fallbackSource 当契约缺少合法 source 时使用的来源标识。
 */
export function parseDesignContract(
  text: string,
  fallbackSource: string,
): DesignContract | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // B1: anchor 必须是非空字符串。
  if (typeof obj.anchor !== "string" || obj.anchor.length === 0) {
    return null;
  }

  // B2 + C1: components 必须是数组，过滤掉非字符串元素后仍非空。
  if (!Array.isArray(obj.components)) {
    return null;
  }
  const components = obj.components.filter(
    (item): item is string => typeof item === "string",
  );
  if (components.length === 0) {
    return null;
  }

  // C2: tokens 三组，每组「其值为对象则用之，否则用 {}」。
  const rawTokens = asRecord(obj.tokens) as Record<string, unknown>;

  // C3: source 为非空字符串则用之，否则回退。
  const source =
    typeof obj.source === "string" && obj.source.length > 0
      ? obj.source
      : fallbackSource;

  return {
    source,
    anchor: obj.anchor,
    tokens: {
      colors: asRecord(rawTokens.colors),
      spacing: asRecord(rawTokens.spacing),
      typography: asRecord(rawTokens.typography),
    },
    components,
  };
}
