import { expect, test } from "vitest";
import { detectBackends, resolveBackend, type Backend } from "../src/agent/backend-routing.js";

test("resolveBackend uses preferred stage backend when available", () => {
  const resolved = resolveBackend("implement", {
    available: new Set<Backend>(["claude", "codex"]),
  });

  expect(resolved).toEqual({ backend: "codex", fellBack: false });
});

test("resolveBackend falls back when preferred backend is down", () => {
  const resolved = resolveBackend("implement", {
    available: new Set<Backend>(["claude", "codex"]),
    down: new Set<Backend>(["codex"]),
  });

  expect(resolved).toEqual({ backend: "claude", fellBack: true });
});

test("resolveBackend honors forced backend when available", () => {
  const resolved = resolveBackend("spec", {
    forced: "codex",
    available: new Set<Backend>(["claude", "codex"]),
  });

  expect(resolved).toEqual({ backend: "codex", fellBack: false });
});

test("resolveBackend returns null when every backend is down", () => {
  const resolved = resolveBackend("implement", {
    available: new Set<Backend>(["claude", "codex"]),
    down: new Set<Backend>(["claude", "codex"]),
  });

  expect(resolved).toBeNull();
});

test("detectBackends uses injected probe and returns available backends", async () => {
  const available = await detectBackends(async (bin) => bin === "codex");

  expect(available).toEqual(new Set<Backend>(["codex"]));
});
