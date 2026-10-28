import { describe, expect, it } from "vitest";
import { classifySensitiveFiles } from "../../src/runtime/sensitive-paths.js";
import { GATE_MUTATIONS } from "../../src/verify/gate-mutation.js";

describe("裁判输入判敏感", () => {
  it.each([
    "orchestrator/.npmrc",
    ".npmrc",
    "orchestrator/tsconfig.json",
    "orchestrator/tsconfig.build.json",
    "orchestrator/vitest.config.ts",
    "orchestrator/vitest.config.mjs",
    "orchestrator/test/vitest-setup.ts",
    "orchestrator/test/integration/setup-db.ts",
    "orchestrator/test/helpers/fixture.ts",
    "orchestrator/test/helpers/deep/x.ts",
    "orchestrator/src/runtime/sensitive-content.ts",
  ])("%s 判敏感", (p) => {
    expect(classifySensitiveFiles([p]).sensitive).toBe(true);
  });

  it.each([
    "orchestrator/test/foo.test.ts",
    "orchestrator/src/helpers/x.ts",
    "docs/tsconfig-notes.md",
    "orchestrator/test/setup-notes.md",
  ])("%s 不判敏感", (p) => {
    expect(classifySensitiveFiles([p]).sensitive).toBe(false);
  });
});

describe("门变异样本库收录裁判输入", () => {
  it.each([
    "sensitive:orchestrator/.npmrc",
    "sensitive:.npmrc",
    "sensitive:orchestrator/tsconfig.json",
    "sensitive:orchestrator/test/vitest-setup.ts",
    "sensitive:orchestrator/test/helpers/fixture.ts",
    "sensitive:orchestrator/src/runtime/sensitive-content.ts",
  ])("%s 在样本库里且被拦下", async (id) => {
    const m = GATE_MUTATIONS.find((x) => x.id === id);
    expect(m).toBeDefined();
    expect(await m!.run()).toBe(true);
  });
});