import type { SelfEvoFinding } from "./self-evo-finding.js";
import type { ModuleStatus } from "../status/types.js";

function lightScore(light: ModuleStatus["light"]): number {
  if (light === "red") return 90;
  if (light === "yellow") return 60;
  return 0;
}

function lightTitle(light: ModuleStatus["light"]): string {
  if (light === "red") return "异常";
  if (light === "yellow") return "需关注";
  return "";
}

function moduleDetail(module: ModuleStatus): string {
  const lines = [
    `模块: ${module.name} (${module.id})`,
    `类别: ${module.category}`,
    `灯色: ${module.light}`,
    `接线: ${module.wired ? "yes" : "no"}`,
  ];

  if (module.lastActivity) {
    lines.push(`最近活动: ${module.lastActivity.summary} / ${module.lastActivity.agoText}`);
    if (module.lastActivity.ok !== undefined) lines.push(`最近结果: ${module.lastActivity.ok ? "ok" : "failed"}`);
  }
  if (module.heartbeat) lines.push(`心跳: ${module.heartbeat.detail}`);
  if (module.note) lines.push(`备注: ${module.note}`);

  return lines.join("\n");
}

function findingForLight(module: ModuleStatus): SelfEvoFinding | undefined {
  // 黄灯=信息态(陈旧 idle/有未读待办/在线但有未读消息)，不是故障——只上仪表盘灯色，
  // 不该堵人工审查区。只有红灯(接线失败/最近报错)才生成待审 finding。未接线另由 findingForUnwired 处理。
  if (module.light !== "red") return undefined;
  const score = lightScore(module.light);
  if (score <= 0) return undefined;

  return {
    channel: "module",
    title: `模块健康：${module.name}${lightTitle(module.light)}`,
    detail: moduleDetail(module),
    sources: [`module:${module.id}`],
    evidenceState: "untested",
    score,
  };
}

function findingForUnwired(module: ModuleStatus): SelfEvoFinding | undefined {
  if (module.wired) return undefined;

  return {
    channel: "module",
    title: `模块健康：${module.name}未接线`,
    detail: moduleDetail(module),
    sources: [`module:${module.id}`],
    evidenceState: "untested",
    score: 85,
  };
}

export function scanModuleHealth(modules: readonly ModuleStatus[]): SelfEvoFinding[] {
  const findings: SelfEvoFinding[] = [];

  for (const module of modules) {
    const unwired = findingForUnwired(module);
    if (unwired) findings.push(unwired);

    const light = findingForLight(module);
    if (light) findings.push(light);
  }

  return findings.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
