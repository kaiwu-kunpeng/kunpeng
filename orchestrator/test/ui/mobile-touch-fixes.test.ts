import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, "..", "..", "src", p), "utf8");

describe("手机触摸/版面修复", () => {
  it("复制按钮在无 hover 环境常显", () => {
    const s = src("server/ui/workbench-panel.ts");
    expect(s).toContain("@media (hover: none)");
    expect(s).toMatch(/hover: none[^}]*\.kp-copy[^}]*opacity/s);
  });

  it("架构图高度改为视口自适应,不再写死 620px", () => {
    const s = src("server/ui/views/architecture.ts");
    expect(s).toContain("clamp(320px, 68vh, 620px)");
    expect(s).not.toContain("height:620px");
  });
});