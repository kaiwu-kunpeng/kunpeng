// 非 macOS 无人值守写入围栏（2026-09-28 审计 R05a）：seatbelt 只在 macOS 可用，
// 其它平台上 claude 后端的 implement 阶段没有任何写入围栏 → 默认拒绝，显式放行或走容器才执行。

export interface UnattendedIsolationInput {
  platform: string;
  stage: string;
  backend: string;
  hasExecBackend: boolean;
  allowUnsandboxed: string | undefined;
}

/** 返回拒绝理由；undefined = 放行。只拦 implement（唯一带 write/edit/bash 的无人值守阶段）；
 *  codex 自带 workspace-write 沙箱（Linux 上同样生效），docker 执行后端由容器隔离。 */
export function unattendedIsolationRefusal(input: UnattendedIsolationInput): string | undefined {
  if (input.stage !== "implement") return undefined;
  if (input.platform === "darwin") return undefined;
  if (input.backend === "codex") return undefined;
  if (input.hasExecBackend) return undefined;
  if (input.allowUnsandboxed === "1") return undefined;
  return `[isolation] 当前平台 ${input.platform} 没有 seatbelt 写入围栏，拒绝在宿主上无人值守运行 ${input.backend} 的 implement 阶段。`
    + "请在 .kunpeng/flow-options.json 配置 execBackend（docker 容器隔离），或改用 codex 后端；"
    + "确认接受宿主直写风险时显式设置 KUNPENG_ALLOW_UNSANDBOXED=1。";
}
