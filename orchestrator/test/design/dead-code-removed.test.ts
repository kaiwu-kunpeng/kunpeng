import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("设计链死代码三件套已删除", () => {
  it("六个文件不复存在", () => {
    for (const f of [
      "src/design/stage.ts",
      "src/design/resolve.ts",
      "src/design/selection.ts",
      "test/design-stage.integration.test.ts",
      "test/design-resolve.test.ts",
      "test/design-selection.test.ts",
    ]) {
      expect(existsSync(f), `${f} 应已删除`).toBe(false);
    }
  });

  it("design 目录无 resolve/selection import 残留；contract 与 candidates 保留", () => {
    const dir = "src/design";
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const src = readFileSync(join(dir, name), "utf8");
      expect(src.includes("./resolve.js"), `${name} 引用 resolve`).toBe(false);
      expect(src.includes("./selection.js"), `${name} 引用 selection`).toBe(false);
    }
    expect(existsSync("src/design/contract.ts")).toBe(true);
    expect(existsSync("src/design/candidates.ts")).toBe(true);
  });
});