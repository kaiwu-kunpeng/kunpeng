import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const uiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "ui");

/** client.ts 源码 + client-parts/*.ts(按文件名序)拼接;分段前后对 grep 断言语义等价。 */
export function clientSource(): string {
  let out = readFileSync(join(uiDir, "client.ts"), "utf8");
  const partsDir = join(uiDir, "client-parts");
  if (existsSync(partsDir)) {
    for (const f of readdirSync(partsDir).filter((n) => n.endsWith(".ts")).sort()) {
      out += "\n" + readFileSync(join(partsDir, f), "utf8");
    }
  }
  return out;
}
