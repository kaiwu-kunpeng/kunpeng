import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { renderSettings } from "../../src/server/ui/views/settings.js";

type State = import("../../src/server/state.js").DashboardState;
const base = {
  backendConfig: { routing: { spec: "claude", design: "claude", implement: "codex", review: "claude", verify: "claude", audit: "claude" }, enabled: ["claude", "codex"] },
  quota: { accounts: [], total: 0 },
  costSummary: { tokensByBackend: {} },
} as unknown as State;

test("生效链一行：claude → codex；无下线时写「无」", () => {
  const html = renderSettings({ ...base, backendHealth: { chain: ["claude", "codex"], down: [], modelsDown: [] } } as unknown as State);
  expect(html).toContain("生效链");
  expect(html).toContain("claude → codex");
  expect(html).toContain("下线");
  expect(html).toContain("无");
});

test("有下线后端与下线模型时逐条显示 kind 与理由", () => {
  const html = renderSettings({
    ...base,
    backendHealth: {
      chain: ["codex"],
      down: [{ backend: "claude", reason: "HTTP 401 Unauthorized", kind: "auth", until: Date.now() + 60_000 }],
      modelsDown: [{ backend: "codex", model: "gpt-6-astra", reason: "retired", kind: "model-unavailable", until: Date.now() + 60_000 }],
    },
  } as unknown as State);
  expect(html).toContain("claude（auth");
  expect(html).toContain("HTTP 401 Unauthorized");
  expect(html).toContain("codex:gpt-6-astra（model-unavailable");
  expect(html).not.toContain("claude → codex");
});

test("没有 backendHealth 字段（旧快照）不崩，也不显示生效链", () => {
  expect(() => renderSettings(base)).not.toThrow();
  expect(renderSettings(base)).not.toContain("生效链");
});

test("dashboard 采集器接线：读健康文件并算生效链", () => {
  const src = readFileSync(new URL("../../src/server/state-collect/dashboard.ts", import.meta.url), "utf8");
  expect(src).toContain("loadBackendHealth(");
  expect(src).toContain("effectiveChain(");
  expect(src).toContain("backendHealth");
});