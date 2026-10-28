import { expect, test } from "vitest";
import { renderShadcnInstall, renderStarterPage } from "../src/design/codegen-scaffold.js";
import type { DesignContract } from "../src/design/contract.js";

const c: DesignContract = {
  source: "house:stone",
  anchor: "shadcn/ui + Geist (stone)",
  tokens: { colors: { background: "#fafaf9" }, spacing: {}, typography: {} },
  components: ["Button", "Card", "Dialog"],
};

test("renderShadcnInstall emits an npx shadcn add line with lowercased component ids", () => {
  const s = renderShadcnInstall(c);
  expect(s).toContain("npx shadcn@latest add");
  expect(s).toContain("button card dialog");
  expect(s).toContain("shadcn/ui + Geist (stone)");
});

test("renderStarterPage emits self-contained HTML using tokens + anchor + components", () => {
  const html = renderStarterPage(c);
  expect(html).toContain("<style");
  expect(html).toContain("#fafaf9");                 // token 值进了页面
  expect(html).toContain("shadcn/ui + Geist (stone)"); // anchor 标题
  expect(html).toContain("Button");                  // 组件样例
});
