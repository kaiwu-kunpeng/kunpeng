import { describe, it, expect } from "vitest";
import { httpSource } from "../helpers/http-source.js";
import { stateSource } from "../helpers/state-source.js";

describe("检查点 state + 端点", () => {
  it("state.ts 声明 productCheckpoints", () => {
    const src = stateSource();
    expect(src).toMatch(/productCheckpoints\?:\s*CheckpointMeta\[\]/);
    expect(src).toMatch(/CheckpointMeta.*from "\.\.\/product\/loop-checkpoint\.js"/s);
  });
  it("http.ts 有 snapshot/rollback 端点并填 productCheckpoints", () => {
    const src = httpSource();
    expect(src).toContain("/api/product/snapshot");
    expect(src).toContain("/api/product/rollback");
    expect(src).toMatch(/listCheckpoints\(/);
    expect(src).toMatch(/restoreCheckpoint\(/);
    expect(src).toMatch(/snapshotLoop\(/);
  });
});
