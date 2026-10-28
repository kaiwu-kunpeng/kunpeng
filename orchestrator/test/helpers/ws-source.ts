import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server");

/** workspace-endpoints.ts 源码 + 已析出的 server 叶子模块拼接;模块化前后对 grep 断言语义等价。 */
export function wsEndpointsSource(): string {
  let out = readFileSync(join(serverDir, "workspace-endpoints.ts"), "utf8");
  for (const extra of ["chat-sse.ts", "workspace-driver-deps.ts", "upload-endpoints.ts", "chat-persistence.ts", "gate-endpoints.ts", "workspace-route.ts", "chat-stream.ts"]) {
    const p = join(serverDir, extra);
    if (existsSync(p)) out += "\n" + readFileSync(p, "utf8");
  }
  return out;
}
