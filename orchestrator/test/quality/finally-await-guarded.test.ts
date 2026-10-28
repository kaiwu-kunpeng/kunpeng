import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

const FILES = [
  "design/tier-probe.ts",
  "design/capturers.ts",
  "web2mcp/generator.ts",
  "web2mcp/network-discoverer.ts",
  "web2mcp/form-discoverer.ts",
  "evolution/run-proposal-eval.ts",
  "product/preview-errors.ts",
  "product/browser-qa.ts",
];

/** 取出每个 finally 块的正文（到配对的收尾大括号为止，按缩进近似切分）。 */
function finallyBlocks(src: string): string[] {
  const out: string[] = [];
  let idx = src.indexOf("} finally {");
  while (idx !== -1) {
    out.push(src.slice(idx, idx + 600));
    idx = src.indexOf("} finally {", idx + 1);
  }
  return out;
}

describe("finally 内的清理 await 都带保护", () => {
  for (const rel of FILES) {
    it(`${rel} 的 finally 内无裸 await`, () => {
      const src = readFileSync(join(srcDir, rel), "utf8");
      const blocks = finallyBlocks(src);
      expect(blocks.length, `${rel} 未找到 finally 块`).toBeGreaterThan(0);
      for (const block of blocks) {
        // 逐行看：出现 await 的行（或其紧邻几行）必须能看到 .catch
        const lines = block.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i] ?? "";
          if (!line.includes("await")) continue;
          const window = lines.slice(i, i + 4).join("\n");
          expect(window, `${rel} 有未加 .catch 的 finally await：${line.trim()}`).toContain(".catch");
        }
      }
    });
  }

  it("八个文件都真的含 .catch 保护", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(srcDir, rel), "utf8");
      expect(src, `${rel} 未见 .catch`).toContain(".catch");
    }
  });
});