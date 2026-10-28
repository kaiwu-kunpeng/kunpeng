import type { AgentRequest, AgentResult, AgentRunner } from "./runner.js";

export type ExecutionKind = "local" | "codex-cloud";

export interface ExecutionBackend {
  readonly kind: ExecutionKind;
  run(req: AgentRequest): Promise<AgentResult>;
}

export class LocalExecutionBackend implements ExecutionBackend {
  readonly kind = "local";

  constructor(private readonly runner: AgentRunner) {}

  run(req: AgentRequest): Promise<AgentResult> {
    return this.runner.run(req);
  }
}

export function selectExecutionKind(
  env: Record<string, string | undefined> = process.env,
): ExecutionKind {
  const normalized = env.KUNPENG_EXECUTION_BACKEND?.trim().toLowerCase();
  return normalized === "codex-cloud" ? "codex-cloud" : "local";
}
