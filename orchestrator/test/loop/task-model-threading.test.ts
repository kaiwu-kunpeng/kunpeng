import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { FakeRunner, type AgentRequest, type AgentResult } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { createDevCycleRunLoop } from "../../src/loop/devcycle-loop-adapter.js";
import {
  WorkspaceDriver,
  type DriverEvent,
  type LoopHandle,
  type RunLoop,
} from "../../src/loop/workspace-driver.js";
import { streamSay, parseWorkspaceRoute } from "../../src/server/workspace-endpoints.js";
import { createWorkspaceTranscript } from "../../src/runtime/workspace-transcript.js";

// 工作台「新任务」里用户选的模型，必须一路透传到跑真活的 runner：
//   client → /events?model= → parseWorkspaceRoute → streamSay → WorkspaceDriver.say
//         → RunLoop → createDevCycleRunLoop → runDevCycle → DevCycle(modelOverride)
//         → 每个阶段的 AgentRequest.model
// 本文件按这条链逐段锁死；未实现前每段都红（must-fail-first）。

const TASK_MODEL = "claude-sonnet-5";

// 记录每个阶段 runner 收到的 req.model。
class CapturingRunner extends FakeRunner {
  readonly models: (string | undefined)[] = [];
  async run(req: AgentRequest): Promise<AgentResult> {
    this.models.push(req.model);
    return super.run(req);
  }
}

const scripted = {
  spec: { text: "## acceptance\n- ok", meta: { testCmd: 'node -e "process.exit(0)"' } },
  implement: { text: "done", meta: {} },
} as const;

async function initRepo(prefix: string): Promise<{ repo: string; store: ArtifactStore; ws: Workspace }> {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
  return { repo, store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")), ws: new Workspace(repo) };
}

describe("任务模型透传（新任务选的模型 → dev-cycle → runner）", () => {
  test("DevCycle 把 modelOverride 注入每个阶段的 runner 请求", async () => {
    const { repo, store, ws } = await initRepo("kp-taskmodel-");
    try {
      const runner = new CapturingRunner(scripted);
      const dc = new DevCycle({ store, ws, runner, flowId: "tm1", modelOverride: TASK_MODEL });
      const result = await dc.run("do it");
      expect(result.status).toBe("verified");
      expect(runner.models.length).toBeGreaterThan(0);
      expect(runner.models.every((m) => m === TASK_MODEL)).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("不给 modelOverride 时 req.model 保持 undefined（默认行为不变）", async () => {
    const { repo, store, ws } = await initRepo("kp-taskmodel-none-");
    try {
      const runner = new CapturingRunner(scripted);
      const dc = new DevCycle({ store, ws, runner, flowId: "tm2" });
      await dc.run("do it");
      expect(runner.models.length).toBeGreaterThan(0);
      expect(runner.models.every((m) => m === undefined)).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("createDevCycleRunLoop 把 model 透传给 runDevCycle（第 4 参）", async () => {
    let seen: string | undefined = "UNSET";
    const runLoop = createDevCycleRunLoop({
      runDevCycle: async (_ws, _msg, onEvent, model) => {
        seen = model;
        onEvent({ type: "done", status: "verified" });
      },
      onMerge: async () => {},
      onReject: async () => {},
    });
    const handle = runLoop("ws1", "hi", TASK_MODEL);
    for await (const _ of handle.events) {
      /* drain */
    }
    expect(seen).toBe(TASK_MODEL);
  });

  test("WorkspaceDriver.say 把 model 透传给 runLoop（第 3 参）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-say-model-"));
    try {
      let seen: string | undefined = "UNSET";
      const runLoop: RunLoop = (_ws, _msg, model): LoopHandle => {
        seen = model;
        async function* gen(): AsyncGenerator<DriverEvent> {
          yield { type: "done" };
        }
        return { events: gen(), answerGate: () => {} };
      };
      const driver = new WorkspaceDriver({ runLoop, transcript: createWorkspaceTranscript(dir) });
      for await (const _ of driver.say("ws1", "hi", TASK_MODEL)) {
        /* drain */
      }
      expect(seen).toBe(TASK_MODEL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("streamSay 把 model 透传给 driver.say（第 5 参）", async () => {
    let seen: string | undefined = "UNSET";
    const fakeDriver = {
      say(_ws: string, _msg: string, model?: string): AsyncIterable<DriverEvent> {
        seen = model;
        async function* gen(): AsyncGenerator<DriverEvent> {
          yield { type: "done" };
        }
        return gen();
      },
    } as unknown as WorkspaceDriver;
    const res = { setHeader() {}, write() {}, end() {} } as unknown as Parameters<typeof streamSay>[3];
    await streamSay(fakeDriver, "ws1", "hi", res, TASK_MODEL);
    expect(seen).toBe(TASK_MODEL);
  });

  test("parseWorkspaceRoute 从 /events?model= 读出任务模型", () => {
    const route = parseWorkspaceRoute("GET", "/api/workspace/ws1/events?msg=hi&model=claude-sonnet-5");
    expect(route?.kind).toBe("events");
    expect(route?.model).toBe("claude-sonnet-5");
  });
});
