import { isRecord } from "../util/is-record.js";
import { effectiveBilledTokens } from "../runtime/billed-tokens.js";

export interface CodexJsonResult {
  /** 所有 agent_message 事件的 text 按出现顺序用 "\n" 连接;无则空串。 */
  text: string;
  /** 所有 turn.completed 事件按 effectiveBilledTokens 四象限口径累加(input−cached + output + 1.25×写 + 0.1×读);无则 0。 */
  tokens: number;
}

/** 解析 codex exec --json 的 JSONL stdout。逐行 JSON.parse,失败的行跳过(忽略非 JSON 噪声行)。
 *  text = 依序收集 type==="item.completed" 且 item.type==="agent_message" 的 item.text,用 "\n" join。
 *  tokens = 累加 type==="turn.completed" 的 effectiveBilledTokens 四象限用量。 */
export function parseCodexJsonl(stdout: string): CodexJsonResult {
  const texts: string[] = [];
  let tokens = 0;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!isRecord(parsed)) continue;

    if (parsed.type === "item.completed" && isRecord(parsed.item)) {
      const item = parsed.item;
      if (item.type === "agent_message" && typeof item.text === "string") {
        texts.push(item.text);
      }
      continue;
    }

    if (parsed.type === "turn.completed" && isRecord(parsed.usage)) {
      const u = parsed.usage;
      const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
      const rawInput = num(u.input_tokens);
      const cached = num(u.cached_input_tokens);
      tokens += effectiveBilledTokens({
        input: rawInput !== undefined && cached !== undefined ? Math.max(0, rawInput - cached) : rawInput,
        output: num(u.output_tokens),
        cacheCreate: num(u.cache_write_input_tokens),
        cacheRead: cached,
      });
    }
  }

  return { text: texts.join("\n"), tokens };
}
