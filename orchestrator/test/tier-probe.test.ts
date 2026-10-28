import { expect, test } from "vitest";
import { FakeTierProbe } from "../src/design/tier-signals.js";
import { AgentTierProbe, pickProbe, PlaywrightTierProbe } from "../src/design/tier-probe.js";
import type { AgentRunner, AgentRequest, AgentResult } from "../src/agent/runner.js";

const fakeRunner: AgentRunner = {
  async run(_r: AgentRequest): Promise<AgentResult> {
    return { text: "{}", meta: {} };
  },
};

function restoreProbeEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.KUNPENG_PROBE;
  } else {
    process.env.KUNPENG_PROBE = value;
  }
}

test("pickProbe defaults to playwright without kind or env", () => {
  const old = process.env.KUNPENG_PROBE;
  try {
    delete process.env.KUNPENG_PROBE;
    expect(pickProbe()).toBeInstanceOf(PlaywrightTierProbe);
  } finally {
    restoreProbeEnv(old);
  }
});

test("pickProbe selects fake by explicit kind", () => {
  expect(pickProbe({ kind: "fake" })).toBeInstanceOf(FakeTierProbe);
});

test("pickProbe selects agent by kind when runner is provided", () => {
  expect(pickProbe({ kind: "agent", runner: fakeRunner })).toBeInstanceOf(AgentTierProbe);
});

test("pickProbe falls back to playwright for agent without runner", () => {
  expect(pickProbe({ kind: "agent" })).toBeInstanceOf(PlaywrightTierProbe);
});

test("pickProbe reads KUNPENG_PROBE when kind is absent", () => {
  const old = process.env.KUNPENG_PROBE;
  try {
    process.env.KUNPENG_PROBE = "fake";
    expect(pickProbe()).toBeInstanceOf(FakeTierProbe);
  } finally {
    restoreProbeEnv(old);
  }
});

test("pickProbe explicit kind overrides KUNPENG_PROBE", () => {
  const old = process.env.KUNPENG_PROBE;
  try {
    process.env.KUNPENG_PROBE = "fake";
    expect(pickProbe({ kind: "playwright" })).toBeInstanceOf(PlaywrightTierProbe);
  } finally {
    restoreProbeEnv(old);
  }
});
