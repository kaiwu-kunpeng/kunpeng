import { describe, expect, test } from "vitest";

import { CLAUDE_TIER, CODEX_TIER } from "../../src/agent/model-routing.js";
import { aggregateTokensByBackend, aggregateTokensByModel } from "../../src/server/state.js";

describe("usage by backend", () => {
  test("混合流按阶段后端归属(不再误算)", () => {
    const flows = [
      {
        stageBackends: { spec: "claude", implement: "codex" },
        stageTokens: { spec: 100, implement: 200 },
      },
    ];
    const specLabel = CLAUDE_TIER.spec.model ?? CLAUDE_TIER.spec.effort;
    const implementLabel = CODEX_TIER.implement.effort ?? CODEX_TIER.implement.model;

    const totals = aggregateTokensByModel(flows);

    expect(specLabel).toBeDefined();
    expect(implementLabel).toBeDefined();
    expect(totals[specLabel!]).toBe(100);
    expect(totals[implementLabel!]).toBe(200);
  });

  test("aggregateTokensByBackend 按后端汇总", () => {
    expect(
      aggregateTokensByBackend([
        {
          stageBackends: { spec: "claude", implement: "codex" },
          stageTokens: { spec: 100, implement: 200 },
        },
      ]),
    ).toEqual({ claude: 100, codex: 200 });
  });

  test("无 stageBackends→回退 flow.backend", () => {
    expect(
      aggregateTokensByBackend([{ backend: "claude", stageTokens: { spec: 50 } }]),
    ).toEqual({ claude: 50 });
  });
});
