import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server");

/** state.ts 源码 + state-*.ts + state-collect/*.ts(按文件名序)拼接;拆分前后对 grep 断言语义等价。 */
export function stateSource(): string {
  let out = readFileSync(join(serverDir, "state.ts"), "utf8");
  for (const f of readdirSync(serverDir).filter((n) => n.startsWith("state-") && n.endsWith(".ts")).sort()) {
    out += "\n" + readFileSync(join(serverDir, f), "utf8");
  }
  const collectDir = join(serverDir, "state-collect");
  if (existsSync(collectDir)) {
    for (const f of readdirSync(collectDir).filter((n) => n.endsWith(".ts")).sort()) {
      out += "\n" + readFileSync(join(collectDir, f), "utf8");
    }
  }
  return out;
}
