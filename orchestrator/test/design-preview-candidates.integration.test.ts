import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type {
  DesignCandidate,
  DesignContract,
} from "../src/design/contract.js";
import { FakeCapturer } from "../src/design/screenshot.js";
import { previewCandidates } from "../src/design/preview-candidates.js";

/** 造一份带可辨识来源/锚点的候选契约。 */
function candidate(source: string): DesignCandidate {
  const contract: DesignContract = {
    source,
    anchor: `anchor:${source}`,
    tokens: {
      colors: { primary: "#000" },
      spacing: { md: "16px" },
      typography: { sans: "system-ui" },
    },
    components: ["Button", "Card"],
  };
  return { source, contract };
}

// AC：3 个候选 → 3 份预览，source 顺序保持，每个 htmlPath/pngPath 落盘且非空。
test("previewCandidates：每个候选渲 HTML + 截图落盘，按输入顺序产出清单", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "kp-preview-candidates-"));
  // source 含冒号，验证文件名走 cand-${i} 而非 source。
  const candidates = [
    candidate("house:neutral"),
    candidate("figma:abc"),
    candidate("house:warm"),
  ];

  const previews = await previewCandidates(
    candidates,
    new FakeCapturer(),
    outDir,
  );

  expect(previews).toHaveLength(3);
  expect(previews.map((p) => p.source)).toEqual([
    "house:neutral",
    "figma:abc",
    "house:warm",
  ]);
  expect(previews.map((p) => p.anchor)).toEqual([
    "anchor:house:neutral",
    "anchor:figma:abc",
    "anchor:house:warm",
  ]);

  for (const p of previews) {
    const htmlStat = await stat(p.htmlPath);
    const pngStat = await stat(p.pngPath);
    expect(htmlStat.size > 0).toBe(true);
    expect(pngStat.size > 0).toBe(true);
    const html = await readFile(p.htmlPath, "utf8");
    expect(html).toContain("<!doctype html>");
  }
});
