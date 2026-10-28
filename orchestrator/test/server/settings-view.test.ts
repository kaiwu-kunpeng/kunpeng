import { test, expect } from "vitest";
import { renderSettings } from "../../src/server/ui/views/settings.js";
import { renderViewFragment } from "../../src/server/ui/render-view.js";

const state = {
  backendConfig: {
    routing: { spec: "claude", design: "claude", implement: "codex", review: "claude", verify: "claude", audit: "claude" },
    enabled: ["claude", "codex"],
  },
  quota: { accounts: [{ id: "acct-1", used: 100, models: [] }], total: 100 },
  costSummary: { tokensByBackend: { claude: 8000, codex: 4000 } },
} as unknown as import("../../src/server/state.js").DashboardState;

test("含设置标题与各区块", () => {
  const html = renderSettings(state);
  expect(html).toContain("设置");
});

test("透出后端路由（implement→codex）与启用后端", () => {
  const html = renderSettings(state);
  expect(html).toContain("implement");
  expect(html).toContain("codex");
  expect(html).toContain("claude");
});

test("透出配额与按后端用量", () => {
  const html = renderSettings(state);
  expect(html).toContain("acct-1");
  expect(html).toContain("8000");
  expect(html).toContain("4000");
});

test("部分/空 state 不崩（防御式）", () => {
  expect(() => renderSettings({} as unknown as import("../../src/server/state.js").DashboardState)).not.toThrow();
});

test("render-view 把 #/settings 路由到设置视图", () => {
  expect(renderViewFragment(state, "#/settings")).toBe(renderSettings(state));
});
