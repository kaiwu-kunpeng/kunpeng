import { expect, test } from "vitest";
import { pickCapturer, PlaywrightCapturer, AgentCapturer } from "../src/design/capturers.js";
import { FakeCapturer } from "../src/design/screenshot.js";
import type { AgentRunner, AgentRequest, AgentResult } from "../src/agent/runner.js";

const fakeRunner: AgentRunner = {
  async run(_r: AgentRequest): Promise<AgentResult> {
    return { text: "done", meta: {} };
  },
};

test("pickCapturer selects by kind; agent needs a runner; default is playwright", () => {
  expect(pickCapturer({ kind: "fake" })).toBeInstanceOf(FakeCapturer);
  expect(pickCapturer({ kind: "agent", runner: fakeRunner })).toBeInstanceOf(AgentCapturer);
  expect(pickCapturer({ kind: "agent" })).toBeInstanceOf(PlaywrightCapturer); // agent 无 runner → 回退默认
  expect(pickCapturer({ kind: "playwright" })).toBeInstanceOf(PlaywrightCapturer);
  expect(pickCapturer()).toBeInstanceOf(PlaywrightCapturer); // 默认
});
