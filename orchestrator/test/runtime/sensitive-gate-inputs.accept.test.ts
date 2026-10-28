import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifySensitiveFiles } from "../../src/runtime/sensitive-paths.js";

const NEWLY_GUARDED_SRC = [
  "src/runtime/merge-tier-evidence.ts",
  "src/server/second-confirm.ts",
  "src/loop/public-surface.ts",
  "src/server/gate-diff.ts",
];

describe("合并分级的输入文件进敏感清单（作者锁定）", () => {
  it.each(NEWLY_GUARDED_SRC.flatMap((file) => [file, `orchestrator/${file}`]))("命中 %s → 守门器源码", (file) => {
    const out = classifySensitiveFiles([file]);
    expect(out.sensitive).toBe(true);
    expect(out.hits.map((hit) => hit.label)).toContain("守门器源码");
  });

  it.each([".kunpeng/flow-options.json", "orchestrator/.kunpeng/flow-options.json"])("命中 %s → 闸门控制面", (file) => {
    const out = classifySensitiveFiles([file]);
    expect(out.hits.map((hit) => hit.label)).toContain("闸门控制面");
  });

  it.each([
    "orchestrator/src/runtime/merge-tier-evidence.test.ts",
    "orchestrator/src/server/gate-diff.test.ts",
    "orchestrator/src/runtime/flow-options.ts",
    "orchestrator/src/server/second-confirm-notes.md",
    ".kunpeng/flow-options.json.bak",
  ])("不命中 %s", (file) => {
    expect(classifySensitiveFiles([file])).toEqual({ sensitive: false, hits: [] });
  });
});

describe("门组装文件的每个相对 import 都已归类（作者锁定·自维护）", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const orchestratorRoot = join(here, "..", "..");
  // 已评估、非敏感：只提供运行时/存储/建议性能力，不改变放行判定。新增 import 要么进敏感清单，要么在这里显式登记。
  const REVIEWED_NON_SENSITIVE = new Set([
    "src/agent/cli-runner.ts",
    "src/artifacts/store.ts",
    "src/runtime/flowstate.ts",
    "src/runtime/gate-futility.ts",
    "src/runtime/gate-git.ts",
    "src/server/pre-review.ts",
    "src/feedback/finding-to-task.ts",
  ]);

  function relativeImports(file: string): string[] {
    const abs = join(orchestratorRoot, file);
    const src = readFileSync(abs, "utf8");
    const out: string[] = [];
    for (const m of src.matchAll(/^import\s[^;]*?from\s+"(\.{1,2}\/[^"]+)"/gm)) {
      const target = join(dirname(abs), m[1]!).replace(/\.js$/, ".ts");
      out.push(relative(orchestratorRoot, target).split("\\").join("/"));
    }
    return out;
  }

  it.each(["src/server/autopilot-guards.ts", "src/loop/autopilot.ts"])("%s 的相对 import 全部归类", (file) => {
    const imports = relativeImports(file);
    expect(imports.length).toBeGreaterThan(2);
    const unclassified = imports.filter((dep) => !REVIEWED_NON_SENSITIVE.has(dep) && !classifySensitiveFiles([dep]).sensitive);
    expect(unclassified).toEqual([]);
  });
});