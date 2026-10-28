import type { Runbook, RunbookEvent } from "./types.js";

/** 首批六条 L0–L2 处置手册（审计 A4 #1 / 总报告 P1-12）。事件种类由值班员从账本/流状态/收件箱派生。 */
export const RUNBOOK_EVENT_KINDS = {
  opsPaused: "ops.playbook.paused",
  opsMissed: "ops.playbook.missed",
  flowGhost: "flow.ghost",
  mergeGuardRed: "merge.guard-red",
  outboxPushFailed: "outbox.push-failed",
  backendDown: "dispatch.backend-down",
} as const;

const HOUR = 3_600_000;
const only = (kind: string) => (event: RunbookEvent): boolean => event.kind === kind;
const retries = (event: RunbookEvent): number => Number(event.detail?.retries ?? 0);

export const RUNBOOK_CATALOG: readonly Runbook[] = [
  {
    id: "rb-ops-paused", rev: 1, title: "运营 playbook 连续失败被自动暂停", maxLevel: "L1", cooldownMs: 24 * HOUR,
    appliesTo: only(RUNBOOK_EVENT_KINDS.opsPaused),
    plan: (e) => [
      { kind: "notify", level: "L1", summary: `playbook ${e.scope.playbookId} 连续 3 次失败已暂停`, scope: e.scope },
      { kind: "draft", level: "L1", summary: `起草恢复建议：核对最近 error 详情后 kunpeng ops resume ${e.scope.playbookId}`, scope: e.scope },
    ],
  },
  {
    id: "rb-ops-missed", rev: 1, title: "运营 playbook 超节拍漏跑", maxLevel: "L2", cooldownMs: 6 * HOUR,
    appliesTo: only(RUNBOOK_EVENT_KINDS.opsMissed),
    plan: (e) => retries(e) >= 1
      ? [{ kind: "notify", level: "L1", summary: `playbook ${e.scope.playbookId} 补跑一次仍漏，疑似调度器失效`, scope: e.scope }]
      : [{ kind: "retry", level: "L2", summary: `补跑 kunpeng ops run-playbook ${e.scope.playbookId}（不与并发锁抢）`, scope: e.scope }],
  },
  {
    id: "rb-flow-ghost", rev: 1, title: "幽灵流：宿主进程已死但状态仍 running", maxLevel: "L2", cooldownMs: 1 * HOUR,
    appliesTo: only(RUNBOOK_EVENT_KINDS.flowGhost),
    plan: (e) => [
      { kind: "stop", level: "L2", summary: `把流 ${e.scope.flowId} 标为 crashed（宿主 pid 不在）`, scope: e.scope },
      { kind: "notify", level: "L1", summary: `流 ${e.scope.flowId} 已按幽灵流收口`, scope: e.scope },
    ],
  },
  {
    id: "rb-merge-guard-red", rev: 1, title: "合并守门测试碰红", maxLevel: "L2", cooldownMs: 2 * HOUR,
    appliesTo: only(RUNBOOK_EVENT_KINDS.mergeGuardRed),
    plan: (e) => retries(e) >= 1
      ? [{ kind: "notify", level: "L1", summary: `流 ${e.scope.flowId} 守门复跑仍红，按真红转人工（集成门假红 SOP 不再适用）`, scope: e.scope }]
      : [{ kind: "retry", level: "L2", summary: `流 ${e.scope.flowId} 守门测试复跑一次（排除负载 flaky）`, scope: e.scope }],
  },
  {
    id: "rb-outbox-push", rev: 1, title: "合并后推送失败进 outbox", maxLevel: "L2", cooldownMs: 1 * HOUR,
    appliesTo: only(RUNBOOK_EVENT_KINDS.outboxPushFailed),
    plan: (e) => retries(e) >= 1
      ? [{ kind: "notify", level: "L1", summary: `流 ${e.scope.flowId} 推送重试仍失败，先 ls-remote 核对远端再人工处理`, scope: e.scope }]
      : [{ kind: "retry", level: "L2", summary: `重放 outbox 推送（流 ${e.scope.flowId}），推前 ls-remote 核对远端未超前`, scope: e.scope }],
  },
  {
    id: "rb-backend-down", rev: 1, title: "派流时后端全部不可用", maxLevel: "L1", cooldownMs: 1 * HOUR,
    appliesTo: only(RUNBOOK_EVENT_KINDS.backendDown),
    plan: (e) => [
      { kind: "degrade", level: "L1", summary: `项目 ${e.scope.projectId} 暂停新派流直到后端健康恢复`, scope: e.scope },
      { kind: "draft", level: "L1", summary: "起草「增额 / 切模型」收件箱卡片", scope: e.scope },
      { kind: "notify", level: "L1", summary: `流 ${e.scope.flowId} 因后端全不可用回滚`, scope: e.scope },
    ],
  },
];
