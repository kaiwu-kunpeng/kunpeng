import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LoopStore } from "../loop/store.js";
import { kunpengStateDir } from "../project/registry.js";
import { resolveSkills } from "../switchboard/agent-card.js";
import { PresenceStore } from "../switchboard/presence.js";
export { isRecord } from "../util/is-record.js";

export function findRepoRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

export function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

export function presenceDir(): string { return join(kunpengStateDir(), "presence"); }

/** dist/cli.js 绝对路径：等价于 cli.ts 内 fileURLToPath(import.meta.url)；模块搬入 cli-commands/ 后经 ../cli.js 恢复。 */
export function cliJsPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
}

export function loopStore(repoRoot: string): LoopStore {
  return new LoopStore(join(repoRoot, ".kunpeng", "loops"));
}

export async function beatPresence(identity: string): Promise<void> {
  try { await new PresenceStore(presenceDir()).beat(identity, Date.now(), { skills: resolveSkills({ env: process.env.KUNPENG_SKILLS }) }); } catch { /* 心跳尽力而为,失败不挡正事 */ }
}

export function withoutValuedFlags(args: string[], flagsToRemove: Set<string>): string[] {
  const kept: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (flagsToRemove.has(args[i])) {
      i++;
      continue;
    }
    kept.push(args[i]);
  }
  return kept;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
