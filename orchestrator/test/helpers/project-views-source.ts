import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectViewsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "ui", "views");

export function projectViewsSource(): string {
  let out = readFileSync(join(projectViewsDir, "project.ts"), "utf8");
  for (const extra of ["project-plans.ts", "project-product.ts", "project-ops.ts"]) {
    const path = join(projectViewsDir, extra);
    if (existsSync(path)) out += "\n" + readFileSync(path, "utf8");
  }
  return out;
}
