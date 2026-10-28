import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFileSizes, countLines } from "../../src/util/file-size-gate.js";

const LIMIT = 600;
const SRC = new URL("../../src/", import.meta.url).pathname;

/** 2026-09-24 main 上超过 600 行的源文件（历史超限，不卡行数）；拆到 600 行以内后删掉条目。 */
const GRANDFATHERED = new Set([
  "agent/cli-runner.ts",
  "chat/conversation-store.ts",
  "cli-commands/loop-core.ts",
  "cli-commands/reports.ts",
  "loop/dev-cycle.ts",
  "security/prompt-shield.ts",
  "server/chat-stream.ts",
  "server/ui/client-parts/part01.ts",
  "server/ui/client-parts/part02.ts",
  "server/ui/client-parts/part03.ts",
  "server/ui/client-parts/part04.ts",
  "server/ui/client-parts/part05.ts",
  "server/ui/client-parts/part06.ts",
  "server/ui/client-parts/part07.ts",
  "server/ui/theme.ts",
  "server/ui/views/overview.ts",
]);

function walk(dir: string, out: Map<string, number>): Map<string, number> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.set(relative(SRC, path), countLines(readFileSync(path, "utf8")));
  }
  return out;
}

describe("源码文件体量增量闸（审计 §1.1，作者锁定）", () => {
  it("当前源码：清单外没有文件超过 600 行，清单里没有死条目", () => {
    const files = walk(SRC, new Map());
    expect(files.size).toBeGreaterThan(500);
    expect(checkFileSizes(files, GRANDFATHERED, LIMIT)).toEqual([]);
  });

  it("判定：清单外超限报 over-limit；清单内不卡行数；清单条目已删或已拆小报 stale-entry", () => {
    const files = new Map([["new/big.ts", 601], ["old/huge.ts", 1500], ["old/split.ts", 300], ["ok.ts", 600]]);
    expect(checkFileSizes(files, new Set(["old/huge.ts", "old/split.ts", "old/gone.ts"]), 600)).toEqual([
      { file: "new/big.ts", lines: 601, reason: "over-limit" },
      { file: "old/gone.ts", lines: 0, reason: "stale-entry" },
      { file: "old/split.ts", lines: 300, reason: "stale-entry" },
    ]);
  });

  it("行数口径与 wc -l 一致", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(0);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("中文\n\n")).toBe(2);
  });
});