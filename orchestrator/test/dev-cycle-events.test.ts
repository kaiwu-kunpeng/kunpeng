import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../src/artifacts/store.js";
import { FakeRunner, type AgentRequest, type AgentResult, type AgentRunner } from "../src/agent/runner.js";
import type { StreamDelta } from "../src/agent/cli-stream-parse.js";
import { Workspace } from "../src/git/workspace.js";
import { DevCycle } from "../src/loop/dev-cycle.js";
import type { KunpengEvent } from "../src/sdk/events.js";

let repo: string;
let store: ArtifactStore;
let ws: Workspace;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-dc-events-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
  store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  ws = new Workspace(repo);
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("DevCycle emits flow stage, gate, and done events in order", async () => {
  const events: KunpengEvent[] = [];
  const runner = new FakeRunner({
    spec: { text: "## acceptance\n- ok", meta: { testCmd: "node -e \"process.exit(0)\"" } },
    implement: { text: "done", meta: {} },
  });

  const dc = new DevCycle({
    store,
    ws,
    runner,
    flowId: "events1",
    onEvent: (event) => events.push(event),
  });

  const result = await dc.run("emit progress events");

  expect(result.status).toBe("verified");
  expect(events.map((event) => event.type)).toEqual(["flow", "flow", "flow", "flow", "gate", "done"]);
  expect(events.filter((event) => event.type === "flow").map((event) => event.stage)).toEqual([
    "spec",
    "audit",
    "implement",
    "verify",
  ]);
  expect(events.every((event) => event.type !== "flow" || event.flowId === "events1")).toBe(true);
  expect(events.find((event) => event.type === "gate")).toMatchObject({
    flowId: "events1",
    what: "合并主干 (人工门#1)",
    detail: "kp/events1 → main",
  });
  expect(events.at(-1)).toMatchObject({ type: "done", flowId: "events1", status: "verified" });
});

test("DevCycle emits rolled-back done event when verification fails", async () => {
  const events: KunpengEvent[] = [];
  const runner = new FakeRunner({
    spec: { text: "## acceptance\n- fail", meta: { testCmd: "node -e \"process.exit(1)\"" } },
    implement: { text: "done", meta: {} },
  });

  const dc = new DevCycle({
    store,
    ws,
    runner,
    flowId: "events2",
    onEvent: (event) => events.push(event),
  });

  const result = await dc.run("emit failure event");

  expect(result.status).toBe("rolled-back");
  expect(events.map((event) => event.type)).toEqual(["flow", "flow", "flow", "flow", "done"]);
  expect(events.at(-1)).toMatchObject({ type: "done", flowId: "events2", status: "rolled-back" });
});

test("DevCycle emits usage events from non-streaming runner token metadata", async () => {
  const events: KunpengEvent[] = [];
  const runner = new FakeRunner({
    spec: { text: "## acceptance\n- ok", meta: { testCmd: "node -e \"process.exit(0)\"", tokens: 100 } },
    implement: { text: "done", meta: { tokens: 25 }, backend: "codex" },
  });

  const dc = new DevCycle({
    store,
    ws,
    runner,
    flowId: "events-usage-meta",
    onEvent: (event) => events.push(event),
  });

  const result = await dc.run("emit token usage");
  const usage = events.filter((event) => event.type === "usage");

  expect(result.status).toBe("verified");
  expect(usage).toEqual([
    { type: "usage", flowId: "events-usage-meta", stage: "spec", output: 100 },
    { type: "usage", flowId: "events-usage-meta", stage: "implement", output: 25, model: "codex" },
  ]);
});

class StreamingRunner implements AgentRunner {
  async run(): Promise<AgentResult> {
    throw new Error("run should not be called when runStreaming exists");
  }

  async runStreaming(req: AgentRequest, onDelta: (d: StreamDelta) => void): Promise<AgentResult> {
    if (req.stage === "spec") {
      onDelta({ text: "## acc" });
      onDelta({ text: "eptance" });
      onDelta({ usage: { input: 10, output: 2, model: "claude-test" } });
      return { text: "## acceptance\n- ok", meta: { testCmd: "node -e \"process.exit(0)\"", tokens: 12 }, backend: "claude" };
    }
    if (req.stage === "implement") {
      onDelta({ text: "do" });
      onDelta({ text: "ne" });
      onDelta({ usage: { input: 20, output: 5, model: "codex-test" } });
      return { text: "done", meta: { tokens: 25 }, backend: "codex" };
    }
    throw new Error(`unexpected stage: ${req.stage}`);
  }
}

test("DevCycle emits precise streaming usage without duplicating token metadata fallback", async () => {
  const events: KunpengEvent[] = [];
  const dc = new DevCycle({
    store,
    ws,
    runner: new StreamingRunner(),
    flowId: "events-usage-stream",
    onEvent: (event) => events.push(event),
  });

  const result = await dc.run("emit streaming usage");
  const usage = events.filter((event) => event.type === "usage");

  expect(result.status).toBe("verified");
  expect(usage).toEqual([
    { type: "usage", flowId: "events-usage-stream", stage: "spec", input: 10, output: 2, model: "claude-test" },
    { type: "usage", flowId: "events-usage-stream", stage: "implement", input: 20, output: 5, model: "codex-test" },
  ]);
});

test("DevCycle forwards streaming text deltas as token events (逐字流真串线)", async () => {
  const events: KunpengEvent[] = [];
  const dc = new DevCycle({
    store,
    ws,
    runner: new StreamingRunner(),
    flowId: "events-token-stream",
    onEvent: (event) => events.push(event),
  });

  const result = await dc.run("emit streaming tokens");
  const tokens = events.filter((event) => event.type === "token");

  expect(result.status).toBe("verified");
  // spec 阶段 "## acc"+"eptance" 与 implement 阶段 "do"+"ne" 都应逐块转成 token 事件
  expect(tokens).toEqual([
    { type: "token", flowId: "events-token-stream", text: "## acc" },
    { type: "token", flowId: "events-token-stream", text: "eptance" },
    { type: "token", flowId: "events-token-stream", text: "do" },
    { type: "token", flowId: "events-token-stream", text: "ne" },
  ]);
});
