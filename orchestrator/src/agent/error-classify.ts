export type CliFailureKind = "auth" | "quota" | "model-unavailable" | "transient" | "fatal" | "killed" | "unknown";

export type CliFailureClass = {
  transient: boolean;
  reason: string;
  kind: CliFailureKind;
};

interface FailurePattern {
  pattern: RegExp;
  reason: string;
}

const AUTH_PATTERNS: FailurePattern[] = [
  { pattern: /not logged in/i, reason: "not logged in" },
  { pattern: /\blogin\b/i, reason: "login" },
  { pattern: /\bunauthorized\b/i, reason: "unauthorized" },
  { pattern: /(^|\D)401(?!\d)/i, reason: "401" },
  { pattern: /(^|\D)403(?!\d)/i, reason: "403" },
  { pattern: /invalid api key/i, reason: "invalid api key" },
  { pattern: /please run \/login/i, reason: "please run /login" },
  { pattern: /authentication required/i, reason: "authentication required" },
  { pattern: /auth(?:entication)? failed/i, reason: "authentication failed" },
];

const QUOTA_PATTERNS: FailurePattern[] = [
  { pattern: /usage limit reached/i, reason: "usage limit reached" },
  { pattern: /quota (?:exceeded|exhausted)/i, reason: "quota exceeded or exhausted" },
  { pattern: /insufficient[ _](?:credits|quota|balance)/i, reason: "insufficient credits/quota/balance" },
  { pattern: /(^|\D)402(?!\d)/i, reason: "402" },
  { pattern: /credit balance is too low/i, reason: "credit balance is too low" },
  { pattern: /out of (?:extra )?usage/i, reason: "out of usage" },
  { pattern: /plan limit/i, reason: "plan limit" },
  { pattern: /\bbilling\b/i, reason: "billing" },
];

const MODEL_PATTERNS: FailurePattern[] = [
  { pattern: /model[^\n]{0,80}\b(?:not found|not available|unavailable|not supported|unsupported|does not exist|has been (?:retired|deprecated|removed))/i, reason: "model unavailable" },
  { pattern: /no such model/i, reason: "no such model" },
  { pattern: /unknown model/i, reason: "unknown model" },
  { pattern: /invalid model/i, reason: "invalid model" },
  { pattern: /not_found_error[^\n]{0,80}model/i, reason: "model not found" },
];

const FATAL_PATTERNS: FailurePattern[] = [
  { pattern: /unknown option/i, reason: "unknown option" },
  { pattern: /invalid argument/i, reason: "invalid argument" },
];

const TRANSIENT_PATTERNS: FailurePattern[] = [
  { pattern: /(^|\D)429(?!\d)/i, reason: "429" },
  { pattern: /rate limit/i, reason: "rate limit" },
  { pattern: /overloaded/i, reason: "overloaded" },
  { pattern: /(^|\D)529(?!\d)/i, reason: "529" },
  { pattern: /(^|\D)500(?!\d)/i, reason: "500" },
  { pattern: /(^|\D)502(?!\d)/i, reason: "502" },
  { pattern: /(^|\D)503(?!\d)/i, reason: "503" },
  { pattern: /(^|\D)504(?!\d)/i, reason: "504" },
  { pattern: /\bETIMEDOUT\b/i, reason: "ETIMEDOUT" },
  { pattern: /\bECONNRESET\b/i, reason: "ECONNRESET" },
  { pattern: /\bECONNREFUSED\b/i, reason: "ECONNREFUSED" },
  { pattern: /socket hang up/i, reason: "socket hang up" },
  { pattern: /fetch failed/i, reason: "fetch failed" },
  { pattern: /\bnetwork\b/i, reason: "network" },
];

export function classifyCliFailure(
  exitCode: number | null,
  stderrTail: string,
  streamTail = "",
): CliFailureClass {
  if (exitCode === null) return { transient: false, reason: "killed", kind: "killed" };

  const failureText = `${stderrTail}\n${streamTail}`;
  const groups: [CliFailureKind, FailurePattern[]][] = [
    ["auth", AUTH_PATTERNS],
    ["quota", QUOTA_PATTERNS],
    ["model-unavailable", MODEL_PATTERNS],
    ["fatal", FATAL_PATTERNS],
    ["transient", TRANSIENT_PATTERNS],
  ];
  for (const [kind, patterns] of groups) {
    for (const candidate of patterns) {
      if (candidate.pattern.test(failureText)) {
        return { transient: kind === "transient", reason: candidate.reason, kind };
      }
    }
  }
  return { transient: false, reason: "unknown", kind: "unknown" };
}

export function isBackendDownKind(kind: CliFailureKind): boolean {
  return kind === "auth" || kind === "quota";
}

export function isModelDownKind(kind: CliFailureKind): boolean {
  return kind === "model-unavailable";
}

export function retryDelayMs(attempt: number): number {
  if (attempt <= 1) return 2_000;
  if (attempt === 2) return 8_000;
  return 20_000;
}
