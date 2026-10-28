export interface EvalOutcome {
  evidenceState: "tested" | "downgraded";
  attached: boolean;
  reason?: string;
}

export function classifyEvalOutcome(input: { ok: true } | { ok: false; error: unknown }): EvalOutcome {
  if (input.ok) {
    return { evidenceState: "tested", attached: true };
  }

  return {
    evidenceState: "downgraded",
    attached: false,
    reason: evalFailureReason(input.error),
  };
}

function evalFailureReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : safeString(error);
  const reason = raw.trim();
  return reason.length > 0 ? reason : "unknown eval failure";
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "unknown eval failure";
  }
}
