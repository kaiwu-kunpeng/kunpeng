export interface SandboxDecisionInput {
  envValue: string | undefined;
  backend?: string;
  cwd: string | undefined;
  scopeAllowCount: number;
  available: boolean;
}

export interface SandboxDecision {
  engaged: boolean;
  reason: string;
}

export function sandboxDecision(input: SandboxDecisionInput): SandboxDecision {
  if (input.envValue !== "1") return { engaged: false, reason: "disabled-by-default" };
  if (input.backend === "codex") return { engaged: false, reason: "codex-incompatible" };
  if (!input.cwd) return { engaged: false, reason: "no-cwd" };
  if (input.scopeAllowCount === 0) return { engaged: false, reason: "no-scope" };
  if (!input.available) return { engaged: false, reason: "sandbox-exec-unavailable" };
  return { engaged: true, reason: "engaged" };
}

export function countSandboxDenials(stdout: string): number {
  if (typeof stdout !== "string" || stdout === "") return 0;
  return stdout.split("Operation not permitted").length - 1;
}
