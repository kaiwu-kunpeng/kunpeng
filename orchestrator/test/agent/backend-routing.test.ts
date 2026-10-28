import { expect, test } from "vitest";
import { resolveBackend } from "../../src/agent/backend-routing.js";

test("routing 覆盖默认:routing.spec=codex → resolveBackend(spec) 选 codex", () => {
  const resolved = resolveBackend("spec", {
    available: new Set(["claude", "codex"]),
    routing: { spec: "codex" },
  });

  expect(resolved?.backend).toBe("codex");
});

test("无 routing→回退 STAGE_BACKEND", () => {
  const resolved = resolveBackend("spec", {
    available: new Set(["claude", "codex"]),
  });

  expect(resolved?.backend).toBe("claude");
});

test("forced 优先于 routing", () => {
  const resolved = resolveBackend("spec", {
    forced: "codex",
    available: new Set(["claude", "codex"]),
    routing: { spec: "claude" },
  });

  expect(resolved?.backend).toBe("codex");
});
