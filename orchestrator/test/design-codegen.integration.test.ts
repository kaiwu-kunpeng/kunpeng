import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { emitDesignCode, type EmittedKind } from "../src/design/codegen.js";
import type { DesignContract } from "../src/design/contract.js";

const contract: DesignContract = {
  source: "house:neutral",
  anchor: "shadcn/ui + Geist (slate)",
  tokens: {
    colors: { background: "#ffffff", primary: "#0f172a" },
    spacing: { md: "1rem" },
    typography: { sans: "Geist" },
  },
  components: ["Button", "Card"],
};

const EXPECTED_KINDS: EmittedKind[] = [
  "shadcn-install",
  "starter-page",
  "tailwind-theme",
  "tokens-css",
];

test("emitDesignCode 落盘 4 个产物：kind 集合相等、每个文件非空", async () => {
  const outDir = join(await mkdtemp(join(tmpdir(), "kp-codegen-")), "design");

  const emitted = await emitDesignCode(contract, outDir);

  // 4 个 kind 排序相等（不依赖落盘顺序）
  expect([...emitted.map((e) => e.kind)].sort()).toEqual([...EXPECTED_KINDS].sort());

  // 每个落盘文件真实存在且非空
  for (const file of emitted) {
    const body = await readFile(file.path, "utf8");
    expect(body.length > 0).toBe(true);
  }
});

test("emitDesignCode 委派下游渲染：globals.css 带 token 变量、INSTALL.md 带小写组件 id", async () => {
  const outDir = join(await mkdtemp(join(tmpdir(), "kp-codegen-")), "nested", "design");

  const emitted = await emitDesignCode(contract, outDir);

  const byKind = (kind: EmittedKind) => emitted.find((e) => e.kind === kind)!;

  const css = await readFile(byKind("tokens-css").path, "utf8");
  expect(css).toContain("--color-background: #ffffff;");

  const install = await readFile(byKind("shadcn-install").path, "utf8");
  expect(install).toContain("button card");
});
