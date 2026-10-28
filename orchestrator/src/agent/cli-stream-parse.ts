export interface StreamDelta {
  text?: string;
  thinking?: string;
  sessionId?: string;
  /** 工具调用开始(tool_use content_block_start):工具名。大文件写入的参数生成期没有 text 增量,靠它让前端有活动信号。 */
  tool?: string;
  /** 工具参数 JSON 的增量字符数；不携带正文，避免大文件内容进入 SSE。 */
  toolInputChars?: number;
  toolId?: string;
  toolResult?: { id: string; ok: boolean };
  usage?: { input?: number; output?: number; cacheCreate?: number; cacheRead?: number; model?: string };
  final?: string;
  error?: string;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstModelName(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.keys(value)[0];
}

export function parseClaudeStreamLine(line: string): StreamDelta | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }

  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const record = obj as Record<string, unknown>;

  if (record.type === "system" && record.subtype === "init") {
    const sessionId = record.session_id;
    return typeof sessionId === "string" && sessionId.length > 0 ? { sessionId } : null;
  }

  if (record.type === "stream_event") {
    const event = record.event;
    if (!event || typeof event !== "object" || Array.isArray(event)) return null;
    const eventRecord = event as Record<string, unknown>;
    if (eventRecord.type === "content_block_start") {
      const block = eventRecord.content_block;
      if (!block || typeof block !== "object" || Array.isArray(block)) return null;
      const blockRecord = block as Record<string, unknown>;
      if (blockRecord.type === "tool_use" && typeof blockRecord.name === "string") {
        if (typeof blockRecord.id === "string") {
          return { tool: blockRecord.name, toolId: blockRecord.id };
        }
        return { tool: blockRecord.name };
      }
      return null;
    }
    if (eventRecord.type !== "content_block_delta") return null;

    const delta = eventRecord.delta;
    if (!delta || typeof delta !== "object" || Array.isArray(delta)) return null;
    const deltaRecord = delta as Record<string, unknown>;

    if (deltaRecord.type === "text_delta" && typeof deltaRecord.text === "string") {
      return { text: deltaRecord.text };
    }
    if (deltaRecord.type === "thinking_delta" && typeof deltaRecord.thinking === "string") {
      return { thinking: deltaRecord.thinking };
    }
    if (deltaRecord.type === "input_json_delta" && typeof deltaRecord.partial_json === "string") {
      return { toolInputChars: deltaRecord.partial_json.length };
    }
    return null;
  }

  if (record.type === "user") {
    const message = record.message;
    if (!message || typeof message !== "object" || Array.isArray(message)) return null;
    const content = (message as Record<string, unknown>).content;
    if (!Array.isArray(content)) return null;
    for (const block of content) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      const blockRecord = block as Record<string, unknown>;
      if (blockRecord.type === "tool_result" && typeof blockRecord.tool_use_id === "string") {
        return { toolResult: { id: blockRecord.tool_use_id, ok: blockRecord.is_error !== true } };
      }
    }
    return null;
  }

  if (record.type === "result") {
    const usageRecord = record.usage && typeof record.usage === "object" && !Array.isArray(record.usage)
      ? record.usage as Record<string, unknown>
      : {};
    return {
      usage: {
        input: numberField(usageRecord.input_tokens),
        output: numberField(usageRecord.output_tokens),
        cacheCreate: numberField(usageRecord.cache_creation_input_tokens),
        cacheRead: numberField(usageRecord.cache_read_input_tokens),
        model: firstModelName(record.modelUsage),
      },
      final: typeof record.result === "string" ? record.result : undefined,
      ...(record.is_error === true && typeof record.result === "string" ? { error: record.result } : {}),
    };
  }

  return null;
}

export function parseCodexThreadId(line: string): string | undefined {
  try {
    const obj: unknown = JSON.parse(line);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
    const record = obj as Record<string, unknown>;
    return record.type === "thread.started" && typeof record.thread_id === "string" && record.thread_id.length > 0
      ? record.thread_id : undefined;
  } catch {
    return undefined;
  }
}

export function parseCodexStreamLine(line: string): StreamDelta | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (/^tokens?\s+used[:\s]+[\d,]+$/i.test(trimmed)) {
    return null;
  }

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { text: line };
  }

  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const record = obj as Record<string, unknown>;
  if (record.type === "item.completed") {
    const item = record.item;
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const itemRecord = item as Record<string, unknown>;
    if (itemRecord.type === "agent_message" && typeof itemRecord.text === "string") {
      return { text: itemRecord.text };
    }
    return null;
  }

  if (record.type === "turn.completed") {
    const usage = record.usage;
    if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
    const usageRecord = usage as Record<string, unknown>;
    // codex(OpenAI 口径):input_tokens 含 cached_input_tokens;拆成 未命中输入 + 缓存命中,与 claude 四象限同义。
    // 没有 OpenAI 字段时(claude 风格 cache_read/cache_creation)原样透传,不做减法。
    const rawInput = numberField(usageRecord.input_tokens);
    const openaiCached = numberField(usageRecord.cached_input_tokens);
    return { usage: {
      input: rawInput !== undefined && openaiCached !== undefined ? Math.max(0, rawInput - openaiCached) : rawInput,
      output: numberField(usageRecord.output_tokens),
      cacheCreate: numberField(usageRecord.cache_write_input_tokens) ?? numberField(usageRecord.cache_creation_input_tokens),
      cacheRead: openaiCached ?? numberField(usageRecord.cache_read_input_tokens),
    } };
  }

  if (record.type === "error" && typeof record.message === "string") {
    return { text: record.message };
  }

  return null;
}
