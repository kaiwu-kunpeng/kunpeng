export interface CheckupResponseInput {
  qaOk: boolean;
  issueCount: number;
  committed: boolean;
  previewUrl?: string;
  previewStarted: boolean;
}

export interface CheckupResponse {
  ok: boolean;
  verdict: string;
  committed: boolean;
  previewStarted: boolean;
  previewUrl?: string;
}

export function buildCheckupResponse(input: CheckupResponseInput): CheckupResponse {
  return {
    ok: input.qaOk,
    verdict: input.qaOk ? "验收通过" : `验收发现 ${input.issueCount} 个问题`,
    committed: input.committed,
    previewStarted: input.previewStarted,
    ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
  };
}
