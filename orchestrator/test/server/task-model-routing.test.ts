import { describe, expect, test } from "vitest";
import { resolveTaskModel } from "../../src/server/workspace-endpoints.js";

// 工作台「新任务」下拉镜像对话下拉(Opus/Sonnet/Codex)。但任务模型透传只把值当作
// claude 的 `--model`(见 cli-runner: req.model → route.model → claude --model)，
// 并不切后端。所以 "codex" 不能当 --model 传给 claude（会炸），必须解释成「强制 codex 后端」。
// resolveTaskModel 把 UI 选择映射成 { backend?, modelOverride? }：
//   - "codex"      → 强制 codex 后端 + modelOverride gpt-5.5（下拉标签「Codex 5.5」，不吃 ~/.codex/config.toml 默认）
//   - "claude-*"   → 作为 modelOverride（claude --model）
//   - 空/未选      → 空（默认行为不变）
// 未实现前每段都红（must-fail-first）。

describe("resolveTaskModel: 新任务模型选择 → 后端/模型路由", () => {
  test("codex → 强制 codex 后端并钉死 gpt-5.5（不当作 claude --model）", () => {
    expect(resolveTaskModel("codex")).toEqual({ backend: "codex", modelOverride: "gpt-5.5" });
  });

  test("claude-* → 作为 modelOverride（claude --model）", () => {
    expect(resolveTaskModel("claude-sonnet-5")).toEqual({ modelOverride: "claude-sonnet-5" });
    expect(resolveTaskModel("claude-opus-4-8")).toEqual({ modelOverride: "claude-opus-4-8" });
  });

  test("空/未选 → 空对象（默认行为不变）", () => {
    expect(resolveTaskModel(undefined)).toEqual({});
    expect(resolveTaskModel("")).toEqual({});
  });
});