import { execFile } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

/** 捕获路由那条路径上 runAutopilot 实际收到的 deps —— 行为断言，不是扫源码。 */
const captured: { deps?: Record<string, unknown>; calls: number } = { calls: 0 };

vi.mock("../../src/loop/autopilot.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/loop/autopilot.js")>();
  return {
    ...actual,
    runAutopilot: async (deps: Record<string, unknown>) => {
      captured.deps = deps;
      captured.calls += 1;
      return { merged: [], skipped: [], rejected: [] };
    },
  };
});

import "../../src/server/routes/gate-actions.js";
import { AUTOPILOT_GUARD_KEYS, buildAutopilotGuards } from "../../src/server/autopilot-guards.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { dispatchModularRoute, type RouteContext } from "../../src/server/routes/registry.js";

console.log("[test] autopilot-guards-wiring suite executing");

/** 造一个真 git 仓：main 上一份 lib/i18n.ts，kp/flow-x 分支改了它。 */
async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kp-apg-"));
  const git = (...args: string[]) => execFileAsync("git", args, { cwd: dir });
  await git("init", "-b", "main");
  await git("config", "user.email", "t@example.com");
  await git("config", "user.name", "t");
  await mkdir(join(dir, "lib"), { recursive: true });
  await writeFile(join(dir, "lib", "i18n.ts"), "export const a = 1;\n");
  await git("add", "lib/i18n.ts");
  await git("commit", "-m", "base");
  await git("checkout", "-b", "kp/flow-x");
  await writeFile(join(dir, "lib", "i18n.ts"), "export const a = 2;\n");
  await git("add", "lib/i18n.ts");
  await git("commit", "-m", "change");
  await git("checkout", "main");
  return dir;
}

async function guardsFor(dir: string) {
  return buildAutopilotGuards(dir, new FlowTracker(join(dir, ".kunpeng", "state")));
}

async function writeSurface(dir: string, raw: string): Promise<void> {
  await mkdir(join(dir, ".kunpeng"), { recursive: true });
  await writeFile(join(dir, ".kunpeng", "public-surface.json"), raw);
}

describe("autopilot 闸的集合定义在一处", () => {
  it("构造器返回的键集合与 AUTOPILOT_GUARD_KEYS 完全相等", async () => {
    const dir = await makeRepo();
    const guards = await guardsFor(dir);
    expect(new Set(Object.keys(guards))).toEqual(new Set(AUTOPILOT_GUARD_KEYS));
  });

  it("每一道闸都是函数，且闸的集合非空", async () => {
    const dir = await makeRepo();
    const guards = await guardsFor(dir);
    expect(AUTOPILOT_GUARD_KEYS.length).toBeGreaterThan(0);
    for (const key of AUTOPILOT_GUARD_KEYS) {
      expect(typeof (guards as Record<string, unknown>)[key], key).toBe("function");
    }
  });
});

describe("publicSurface 搬迁后行为不变", () => {
  it("没有 public-surface.json → 不命中", async () => {
    const dir = await makeRepo();
    const guards = await guardsFor(dir);
    await expect(guards.publicSurface("flow-x", "main")).resolves.toEqual({ touched: false });
  });

  it("patterns 命中改动文件 → 命中且 files 含该文件", async () => {
    const dir = await makeRepo();
    await writeSurface(dir, JSON.stringify({ patterns: ["lib/**"] }));
    const guards = await guardsFor(dir);
    const result = await guards.publicSurface("flow-x", "main");
    expect(result.touched).toBe(true);
    expect(result.files).toContain("lib/i18n.ts");
  });

  it("JSON 损坏 → 抛错（交给 autopilot 的保守分支保留门）", async () => {
    const dir = await makeRepo();
    await writeSurface(dir, "{ 这不是 json");
    const guards = await guardsFor(dir);
    await expect(guards.publicSurface("flow-x", "main")).rejects.toThrow(/public-surface\.json/);
  });

  it("patterns 不是 string[] → 抛错（交给 autopilot 的保守分支保留门）", async () => {
    const dir = await makeRepo();
    await writeSurface(dir, JSON.stringify({ patterns: [1, 2] }));
    const guards = await guardsFor(dir);
    await expect(guards.publicSurface("flow-x", "main")).rejects.toThrow(/patterns/);
  });
});

describe("驾驶舱那条路径也过同一套闸", () => {
  it("POST /api/autopilot 真派发一次后，runAutopilot 收到了全部闸", async () => {
    const dir = await makeRepo();
    captured.deps = undefined;
    captured.calls = 0;

    const req = Readable.from([Buffer.from(JSON.stringify({ projectId: "x" }))]) as unknown as IncomingMessage;
    let payload = "";
    const res = {
      setHeader() {},
      end(chunk?: string) { payload = chunk ?? ""; },
    } as unknown as ServerResponse;
    const context: RouteContext = { stateDir: dir, repoRoot: dir };

    await dispatchModularRoute("POST", "/api/autopilot", req, res, context);

    expect(captured.calls, "路由没有走到 runAutopilot：" + payload).toBe(1);
    const deps: Record<string, unknown> = captured.deps ?? {};
    for (const key of AUTOPILOT_GUARD_KEYS) {
      expect(typeof deps[key], "驾驶舱路径少接了闸 " + key).toBe("function");
    }
  });
});