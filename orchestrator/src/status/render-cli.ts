import type { Category, Light, ModuleStatusReport } from "./types.js";

const glyphByLight: Record<Light, string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
  idle: "⚪",
};

const categoryOrder: Category[] = ["research-loop", "comms", "governance", "ops", "platform"];

const titleByCategory: Record<Category, string> = {
  "research-loop": "研发循环",
  comms: "通讯",
  governance: "治理",
  ops: "运维",
  platform: "平台",
};

export function renderModuleStatusCli(report: ModuleStatusReport): string {
  const lines = [
    `鲲鹏模块状态  🟢${report.rollup.green} 🟡${report.rollup.yellow} 🔴${report.rollup.red} ⚪${report.rollup.idle}  共${report.modules.length}个模块`,
  ];

  for (const category of categoryOrder) {
    const modules = report.modules.filter((module) => module.category === category);
    if (modules.length === 0) continue;

    lines.push(titleByCategory[category]);
    for (const module of modules) {
      const activity = module.lastActivity
        ? `${module.lastActivity.summary}(${module.lastActivity.agoText})`
        : "—";
      const heartbeat = module.heartbeat
        ? ` ｜${module.heartbeat.online ? "♥在线" : "✘离线"}`
        : "";
      const note = module.note ? ` ｜${module.note}` : "";
      lines.push(`${glyphByLight[module.light]} ${module.name.padEnd(14)}  ${activity}${heartbeat}${note}`);
    }
  }

  lines.push(`生成于 ${new Date(report.generatedAt).toISOString()}`);
  return lines.join("\n");
}
