import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const shims = [
  "../src/product/discover.ts",
  "../src/product/shape.ts",
  "../src/product/validate.ts",
  "../src/server/views/loops.ts",
];

test("重构后遗留的 re-export shim 均已删除", () => {
  for (const rel of shims) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    expect(existsSync(p), `${rel} 应已被删除`).toBe(false);
  }
});