import { beforeAll, describe, expect, it } from "vitest";
import { runAutopilot, type AutopilotDeps } from "../../src/loop/autopilot.js";
import { matchesPublicSurface } from "../../src/loop/public-surface.js";

beforeAll(() => process.stdout.write("[test] public-surface suite executing\n"));

function flow(requirement = "更新普通实现") {
  return {
    flowId: "public-flow",
    status: "verified",
    requirement,
    humanGate: { gate: "合并主干", what: "public-flow → main" },
  };
}

function harness(
  publicSurface?: AutopilotDeps["publicSurface"],
  requirement?: string,
): { deps: AutopilotDeps; mergeCalls: () => number } {
  let calls = 0;
  const deps: AutopilotDeps = {
    tracker: { list: async () => [flow(requirement)] } as unknown as AutopilotDeps["tracker"],
    merge: async () => {
      calls++;
      return { ok: true };
    },
  };
  if (publicSurface) deps.publicSurface = publicSurface;
  return { deps, mergeCalls: () => calls };
}

describe("matchesPublicSurface", () => {
  it.each([
    {
      changedFiles: ["lib/i18n.ts"],
      patterns: ["lib/i18n.ts"],
      expected: ["lib/i18n.ts"],
    },
    {
      changedFiles: ["app/parts/x/page.tsx"],
      patterns: ["app/**/page.tsx"],
      expected: ["app/parts/x/page.tsx"],
    },
    {
      changedFiles: ["app/parts/x/route.ts"],
      patterns: ["app/**/page.tsx"],
      expected: [],
    },
    {
      changedFiles: ["libx/i18n.ts"],
      patterns: ["lib/*.ts"],
      expected: [],
    },
    {
      changedFiles: ["lib/i18n.ts"],
      patterns: [],
      expected: [],
    },
  ])("匹配 $changedFiles × $patterns", ({ changedFiles, patterns, expected }) => {
    expect(matchesPublicSurface(changedFiles, patterns)).toEqual(expected);
  });

  it("命中文件保序并去重", () => {
    expect(matchesPublicSurface(
      ["app/a/page.tsx", "lib/i18n.ts", "app/a/page.tsx"],
      ["app/**/page.tsx", "lib/*.ts"],
    )).toEqual(["app/a/page.tsx", "lib/i18n.ts"]);
  });
});

describe("runAutopilot 对外面人工门", () => {
  it("命中对外面时保留人工门且不调用 merge", async () => {
    const { deps, mergeCalls } = harness(async () => ({
      touched: true,
      files: ["lib/i18n.ts"],
    }));

    const result = await runAutopilot(deps);

    expect(result.merged).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ flowId: "public-flow" });
    expect(result.skipped[0].reason).toContain("lib/i18n.ts");
    expect(mergeCalls()).toBe(0);
  });

  it("未命中对外面时正常合并", async () => {
    const { deps, mergeCalls } = harness(async () => ({ touched: false }));

    const result = await runAutopilot(deps);

    expect(result.merged).toEqual(["public-flow"]);
    expect(mergeCalls()).toBe(1);
  });

  it("未注入对外面检查时保持原有合并行为", async () => {
    const { deps, mergeCalls } = harness();

    const result = await runAutopilot(deps);

    expect(result.merged).toEqual(["public-flow"]);
    expect(mergeCalls()).toBe(1);
  });

  it("对外面检查异常时保守保留门且不调用 merge", async () => {
    const { deps, mergeCalls } = harness(async () => {
      throw new Error("git diff 失败");
    });

    const result = await runAutopilot(deps);

    expect(result.merged).toEqual([]);
    expect(result.skipped[0].reason).toContain("git diff 失败");
    expect(mergeCalls()).toBe(0);
  });
});
