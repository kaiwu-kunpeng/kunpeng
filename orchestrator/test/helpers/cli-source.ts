import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** cli.ts 源码 + cli-commands/*.ts 拼接;命令模块化前后对 grep 断言语义等价。 */
export function cliSource(): string {
  let out = readFileSync(join(srcDir, "cli.ts"), "utf8");
  const commandsDir = join(srcDir, "cli-commands");
  if (existsSync(commandsDir)) {
    for (const f of readdirSync(commandsDir).filter((n) => n.endsWith(".ts")).sort()) {
      out += "\n" + readFileSync(join(commandsDir, f), "utf8");
    }
  }
  return out;
}

/** 仅 cli.ts 入口源码(终态守门用;唯一被豁免直读 cli.ts 的位置)。 */
export function cliEntrySource(): string {
  return readFileSync(join(srcDir, "cli.ts"), "utf8");
}
