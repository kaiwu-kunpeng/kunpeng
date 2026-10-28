import { expect, test } from "vitest";
import type { DesignContract } from "../src/design/contract.js";
import { renderPreviewHtml } from "../src/design/preview.js";

const c: DesignContract = {
  source: "house:slate",
  anchor: "shadcn/ui + Geist (slate)",
  tokens: {
    colors: {
      background: "#f8fafc",
      foreground: "#020817",
      primary: "#0f172a",
    },
    spacing: { md: "16px" },
    typography: { body: "Geist 16/24" },
  },
  components: ["Button", "Card"],
};

test("renderPreviewHtml produces a self-contained html preview", () => {
  const html = renderPreviewHtml(c);

  // 自包含：内联 <style>
  expect(html).toContain("<style");
  // token 展开为 CSS 变量（逐字匹配，冒号后无空格）
  expect(html).toContain("--background:#f8fafc");
  // anchor 作为标题出现
  expect(html).toContain("shadcn/ui + Geist (slate)");
  // 每个组件名各出现
  expect(html).toContain("Button");
  expect(html).toContain("Card");
});
