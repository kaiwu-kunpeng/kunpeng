import { expect, test } from "vitest";
import { backendForStage } from "../src/agent/backend-routing.js";

test("default mix: implement→codex, others→claude", () => {
  expect(backendForStage("implement")).toBe("codex");
  expect(backendForStage("spec")).toBe("claude");
  expect(backendForStage("audit")).toBe("claude");
  expect(backendForStage("verify")).toBe("claude");
});

test("forced backend overrides all stages (逃生口)", () => {
  expect(backendForStage("implement", "claude")).toBe("claude"); // 强制 claude
  expect(backendForStage("spec", "codex")).toBe("codex");        // 强制 codex
});
