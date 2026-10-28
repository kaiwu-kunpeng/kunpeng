import { resolveStepTimeoutMs } from "./aop-timeout.js";

export interface AopStep {
  id: string;
  prompt: string;
  assert?: string;
  external?: boolean;
  timeoutMs?: number;
}

export interface AopPlan {
  goal: string;
  steps: AopStep[];
}

export function parseAop(md: string): AopPlan | undefined {
  const match = /```aop\s*\n([\s\S]*?)```/.exec(md);
  if (!match) return undefined;

  try {
    const parsed = JSON.parse(match[1]);
    if (typeof parsed !== "object" || parsed === null) return undefined;

    const goal = (parsed as { goal?: unknown }).goal;
    const steps = (parsed as { steps?: unknown }).steps;
    if (typeof goal !== "string" || !Array.isArray(steps)) return undefined;

    const normalizedSteps = steps.map((step) => {
      if (typeof step !== "object" || step === null) return step as AopStep;

      const candidate = step as Record<string, unknown>;
      const timeoutMs = resolveStepTimeoutMs(
        typeof candidate.timeoutMs === "number" ? candidate.timeoutMs : undefined,
        {},
      );
      return { ...candidate, timeoutMs } as unknown as AopStep;
    });

    return { goal, steps: normalizedSteps };
  } catch {
    return undefined;
  }
}
