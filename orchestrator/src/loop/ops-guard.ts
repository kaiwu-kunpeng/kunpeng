import type { OpsAction } from "./action-ledger.js";

const SENSITIVE_WAVE_PATTERNS: RegExp[] = [
  /部署|deploy|发布|publish/i,
  /删除|drop|rm -rf|清空/i,
  /付费|付款|(?<![\w\-./])(?:charg(?:e[ds]?|ing)|pay(?:ment)?)(?![\w\-./])/i,
  /生产|production/i,
  /凭证|credential|secret/i,
];

export interface OpsGuardVerdict {
  allow: boolean;
  reason?: string;
  kind?: "halt" | "sensitive" | "budget";
}

export interface WindowFailureStats {
  considered: number;
  failed: number;
  rate: number;
}

export interface GuardWaveInput {
  actions: OpsAction[];
  loopId: string;
  waveText: string;
  observational?: boolean;
  haltThreshold?: number;
  failureWindow?: number;
  failureRateThreshold?: number;
  minWindowSamples?: number;
  tokenBudget?: number;
  tokensSpent30d?: number;
}

export function consecutiveNoProgress(
  actions: OpsAction[],
  loopId: string,
  opts?: { observational?: boolean },
): number {
  const loopActions = actions
    .filter((action) => action.loopId === loopId)
    .sort((a, b) => a.at - b.at);

  let count = 0;
  for (let index = loopActions.length - 1; index >= 0; index -= 1) {
    const action = loopActions[index];
    if (action.guardReset === true) break;
    if (action.instrumentBroken === true) continue;
    if (opts?.observational === true) {
      if (action.verified === true) break;
      if (action.verified === false) count += 1;
      continue;
    }
    if (action.metricDelta > 0 && action.verified === true) break;
    if (action.metricDelta <= 0 || !action.verified) count += 1;
  }
  return count;
}

export function windowFailureRate(
  actions: OpsAction[],
  loopId: string,
  opts?: { window?: number; observational?: boolean },
): WindowFailureStats {
  const loopActions = actions
    .filter((action) => action.loopId === loopId)
    .sort((a, b) => a.at - b.at);

  let afterReset = loopActions;
  for (let index = loopActions.length - 1; index >= 0; index -= 1) {
    if (loopActions[index].guardReset === true) {
      afterReset = loopActions.slice(index + 1);
      break;
    }
  }

  afterReset = afterReset.filter((action) => action.instrumentBroken !== true);
  const window = opts?.window ?? 30;
  const consideredActions = afterReset.slice(Math.max(0, afterReset.length - window));
  const failed = consideredActions.filter((action) => {
    if (opts?.observational === true) return action.verified === false;
    return action.metricDelta <= 0 || !action.verified;
  }).length;
  const considered = consideredActions.length;

  return {
    considered,
    failed,
    rate: considered === 0 ? 0 : failed / considered,
  };
}

export function isSensitiveWave(text: string): boolean {
  return SENSITIVE_WAVE_PATTERNS.some((pattern) => pattern.test(text));
}

function environmentTokenBudget(): number | undefined {
  const parsed = Number(process.env.KP_OPS_WAVE_TOKEN_BUDGET);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function guardWave(input: GuardWaveInput): OpsGuardVerdict {
  const failureWindow = input.failureWindow ?? 30;
  const failureRateThreshold = input.failureRateThreshold ?? 0.8;
  const minWindowSamples = input.minWindowSamples ?? 3;
  const stats = windowFailureRate(input.actions, input.loopId, {
    window: failureWindow,
    observational: input.observational,
  });
  if (stats.considered >= minWindowSamples && stats.rate >= failureRateThreshold) {
    return {
      allow: false,
      kind: "halt",
      reason: `窗口内失败 ${stats.failed}/${stats.considered} 次（${(stats.rate * 100).toFixed(0)}%），达到熔断阈值 ${(failureRateThreshold * 100).toFixed(0)}%`,
    };
  }

  if (isSensitiveWave(input.waveText)) {
    return {
      allow: false,
      kind: "sensitive",
      reason: `波次内容命中敏感动作：${input.waveText}`,
    };
  }

  const tokenBudget = input.tokenBudget ?? environmentTokenBudget();
  const tokensSpent30d = input.tokensSpent30d ?? 0;
  if (tokenBudget !== undefined && tokensSpent30d >= tokenBudget) {
    return {
      allow: false,
      kind: "budget",
      reason: `近 30 天 token 消耗 ${tokensSpent30d} 已达到波级预算 ${tokenBudget}`,
    };
  }

  return { allow: true };
}
