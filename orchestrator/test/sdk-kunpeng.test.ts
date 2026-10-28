import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { Kunpeng } from "../src/index.js";
import { FakeRunner } from "../src/agent/runner.js";
import type { KunpengEvent } from "../src/sdk/events.js";

let repo: string;
let home: string;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-sdk-kunpeng-repo-"));
  home = mkdtempSync(join(tmpdir(), "kp-sdk-kunpeng-home-"));
  mkdirSync(join(home, ".kunpeng"), { recursive: true });
  writeFileSync(join(home, ".kunpeng", "accounts.json"), "[]");
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("Kunpeng.plan returns a typed PlanResult, emits events, and does not exit or log", async () => {
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const events: KunpengEvent[] = [];
  const runner = new FakeRunner({
    spec: { text: "## acc\n- ok", meta: { testCmd: "node -e \"process.exit(0)\"" } },
    implement: { text: "implemented", meta: {} },
  });
  const kp = new Kunpeng({ repo, home, runner, checks: [], concurrency: 1, now: () => 12345 });
  kp.on("phase", (event) => events.push(event));
  kp.on("done", (event) => events.push(event));

  const result = await kp.plan(`
## phase one
### flow one
Do the thing.

\`\`\`accept
node -e "process.exit(0)"
\`\`\`
`);

  expect(result.status).toBe("verified");
  // plan id 现含随机段（plan-<时间>-<hex>，防并发撞集成分支）；时间段仍由注入的 now 决定。
  expect(result.planId).toMatch(/^plan-9ix-[0-9a-f]{6}$/);
  const pid = result.planId;
  expect(result.flows).toEqual([{ flowId: "phase-one-0-0", phase: 0, status: "verified" }]);
  expect(events).toContainEqual({ type: "phase", planId: pid, phase: "phase one", index: 0, total: 1 });
  expect(events.at(-1)).toEqual({ type: "done", planId: pid, status: "verified" });
  expect(exitSpy).not.toHaveBeenCalled();
  expect(logSpy).not.toHaveBeenCalled();
  expect(errorSpy).not.toHaveBeenCalled();

  exitSpy.mockRestore();
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

test("Kunpeng.state returns DashboardState", async () => {
  const kp = new Kunpeng({ repo, home, checks: [] });

  const state = await kp.state();

  expect(state.systemLight).toBe("green");
  expect(state.artifacts).toEqual({});
  expect(state.running).toEqual([]);
});
