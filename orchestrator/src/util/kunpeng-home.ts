import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 鲲鹏 HOME（宪法/角色卡/技能与账号、配额所在的仓根）的唯一解析来源。
 * 非空的 KUNPENG_HOME 优先；否则从本模块位置回推：
 * <repo>/orchestrator/{src,dist}/util/kunpeng-home.{ts,js} 向上三级 = 仓根。
 * 注意：它不是 ~/.kunpeng 中央状态目录（那是 project/state-dir.ts 的 KUNPENG_STATE 口径）。
 */
export function resolveKunpengHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.KUNPENG_HOME;
  if (fromEnv) return fromEnv;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}
