import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { launchKunpeng, type SpawnFn } from "../src/server/launch.js";

interface CapturedLaunchOptions {
  env: NodeJS.ProcessEnv;
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-fl-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("FlowState.start 存 logPath、read 取回", async () => {
  const t = new FlowTracker(join(dir, "state"));
  await t.start("f1", "需求", { logPath: "/tmp/x.log" });
  expect((await t.read("f1"))!.logPath).toBe("/tmp/x.log");
  await t.start("f2", "需求");
  expect((await t.read("f2"))!.logPath).toBeUndefined();
});

test("launchKunpeng 经 env KUNPENG_FLOW_LOG 把 logPath 透传给子进程", () => {
  let captured: CapturedLaunchOptions | undefined;
  const fakeSpawn = ((_e: string, _a: string[], opts: unknown) => {
    captured = opts as CapturedLaunchOptions;
    return { pid: 5, unref() {} } as ReturnType<SpawnFn>;
  }) as SpawnFn;
  const r = launchKunpeng({ execPath: "node", cliJs: "cli.js", spawn: fakeSpawn }, ["run", "x"], dir);
  expect(captured?.env.KUNPENG_FLOW_LOG).toBe(r.logPath);
  expect(captured?.env.PATH).toBeDefined();
});
