import { expect, test } from "vitest";
import { themeCss } from "../../src/server/ui/theme.js";

test("themeCss exposes Orange shared UI styles", () => {
  expect(themeCss).toContain("--primary:#8D4B00");
  expect(themeCss).toContain("--success:#177E4D");
  expect(themeCss).toContain(".nav-item.active");
  expect(themeCss).toContain(".hero");
  expect(themeCss).toContain(".kpi");
  expect(themeCss).toContain("@media");
});
