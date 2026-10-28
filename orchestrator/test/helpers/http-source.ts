import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server");

/** http.ts 源码 + routes/*.ts + 已析出的 server 叶子模块拼接;路由模块化前后对 grep 断言语义等价。 */
export function httpSource(): string {
  let out = readFileSync(join(serverDir, "http.ts"), "utf8");
  for (const extra of ["project-scope.ts", "read-body.ts", "net-util.ts", "view-state.ts", "beacon-static.ts", "conversation-glue.ts", "webhook-endpoints.ts", "auth-flow.ts", "localfs/http-route.ts"]) {
    const p = join(serverDir, extra);
    if (existsSync(p)) out += "\n" + readFileSync(p, "utf8");
  }
  const routesDir = join(serverDir, "routes");
  if (existsSync(routesDir)) {
    for (const f of readdirSync(routesDir).filter((n) => n.endsWith(".ts")).sort()) {
      out += "\n" + readFileSync(join(routesDir, f), "utf8");
    }
  }
  return out;
}
