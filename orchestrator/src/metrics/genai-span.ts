export interface StageUsage {
  stage: string;
  model?: string;
  backend?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  ok?: boolean;
}

export interface GenAiSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
}

export function buildGenAiSpan(u: StageUsage): GenAiSpan {
  const attributes: Record<string, string | number | boolean> = {
    "gen_ai.operation.name": u.stage,
  };

  if (u.model !== undefined) {
    attributes["gen_ai.request.model"] = u.model;
  }
  if (u.backend !== undefined) {
    attributes["gen_ai.system"] = u.backend;
  }
  if (typeof u.inputTokens === "number") {
    attributes["gen_ai.usage.input_tokens"] = u.inputTokens;
  }
  if (typeof u.outputTokens === "number") {
    attributes["gen_ai.usage.output_tokens"] = u.outputTokens;
  }
  if (typeof u.durationMs === "number") {
    attributes["kunpeng.stage.duration_ms"] = u.durationMs;
  }
  if (typeof u.ok === "boolean") {
    attributes["kunpeng.stage.ok"] = u.ok;
  }

  return {
    name: `gen_ai.${u.stage}`,
    attributes,
  };
}
