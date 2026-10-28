import { expect, test } from "vitest";
import { renderSettings } from "../src/server/ui/views/settings.js";
import type { DashboardState } from "../src/server/state.js";

test("settings 含 light/dark 切换钩", () => {
  const html = renderSettings({} as unknown as DashboardState);
  expect(html).toContain("偏好");
  expect(html).toContain("白天");
  expect(html).toContain('data-theme-set="light"');
  expect(html).toContain('data-theme-set="dark"');
  expect(html).toContain("夜间");
});
