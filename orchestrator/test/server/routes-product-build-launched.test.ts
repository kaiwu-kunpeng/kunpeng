import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import "../../src/server/routes/product-build.js";
import { dispatchModularRoute } from "../../src/server/routes/registry.js";
import { writeInterview } from "../../src/product/store.js";
import { writeLoopState } from "../../src/product/loop-store.js";
import { draftStage, initState, type ProductStage } from "../../src/product/stage-machine.js";
import { productSlug } from "../../src/product/artifacts.js";

const NOW = 1_800_000_000_000;
const IDEA = "Demo Product";

let repo: string;
let home: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "kp-pbl-home-"));
  repo = mkdtempSync(join(tmpdir(), "kp-pbl-repo-"));
  process.env.HOME = home;
  const def = {
    idea: IDEA,
    problem: "当用户接受产品阶段时，需要保留启动状态的可观测响应",
    users: ["u"],
    stories: ["s"],
    acceptance: ["a"],
    nonGoals: [],
  };
  await writeInterview(repo, { idea: IDEA, status: "done", step: 5, answers: [], definition: def } as never);
  await writeLoopState(repo, initState(productSlug(IDEA), IDEA, NOW));
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

function mkReq(body: unknown) {
  const r = new EventEmitter() as EventEmitter & { headers: Record<string, string> };
  r.headers = {};
  setTimeout(() => { r.emit("data", Buffer.from(JSON.stringify(body))); r.emit("end"); }, 10);
  return r as never;
}

function mkRes() {
  const chunks: string[] = [];
  return {
    chunks,
    setHeader() {},
    end(s?: string) { if (s) chunks.push(s); },
  };
}

async function accept(stage: string, ctx: Record<string, unknown>): Promise<Record<string, unknown>> {
  const state = initState(productSlug(IDEA), IDEA, NOW);
  await writeLoopState(repo, draftStage(state, stage as ProductStage, "", NOW));
  const res = mkRes();
  await dispatchModularRoute(
    "POST", "/api/product/accept",
    mkReq({ projectId: "p", stage }),
    res as never,
    { stateDir: join(home, ".kunpeng"), repoRoot: repo, ...ctx } as never,
  );
  return JSON.parse(res.chunks[0] ?? "{}") as Record<string, unknown>;
}

describe("审计修复S product accept build launched 可观测", () => {
  it("配置启动器:launched:true 且 spawn 恰调一次", async () => {
    const spawnCalls: unknown[][] = [];
    const fakeSpawn = (...args: unknown[]) => { spawnCalls.push(args); return { unref() {}, on() {}, pid: 1 } as never; };
    const parsed = await accept("build", { execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn: fakeSpawn });
    expect(parsed.ok).toBe(true);
    expect(parsed.launched).toBe(true);
    expect(spawnCalls.length).toBe(1);
  });

  it("未配置启动器:不再静默,launched:false 且 spawn 不被调", async () => {
    const spawnCalls: unknown[][] = [];
    const fakeSpawn = (...args: unknown[]) => { spawnCalls.push(args); return { unref() {}, on() {}, pid: 1 } as never; };
    const parsed = await accept("build", { spawn: fakeSpawn });
    expect(parsed.ok).toBe(true);
    expect(parsed.launched).toBe(false);
    expect(spawnCalls.length).toBe(0);
  });

  it("非 build 阶段响应形状不变:无 launched 键", async () => {
    const parsed = await accept("spec", {});
    expect(parsed.ok).toBe(true);
    expect("launched" in parsed).toBe(false);
  });
});
