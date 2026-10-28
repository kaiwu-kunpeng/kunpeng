import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { AUTOPILOT_GUARD_KEYS, buildAutopilotGuards } from "../../src/server/autopilot-guards.js";
import { runAutopilot } from "../../src/loop/autopilot.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

const execFileAsync = promisify(execFile);

/** 造一个真 git 仓:main 上一份 lib/i18n.ts,每个 kp/<flowId> 分支各改一组文件。 */
async function makeRepo(branches: Record<string, string[]>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kp-sens-guard-"));
  const git = (...args: string[]) => execFileAsync("git", args, { cwd: dir });
  await git("init", "-b", "main");
  await git("config", "user.email", "t@example.com");
  await git("config", "user.name", "t");
  await mkdir(join(dir, "lib"), { recursive: true });
  await writeFile(join(dir, "lib", "i18n.ts"), "export const a = 1;\n");
  await git("add", "lib/i18n.ts");
  await git("commit", "-m", "base");
  for (const [flowId, files] of Object.entries(branches)) {
    await git("checkout", "-b", `kp/${flowId}`, "main");
    for (const file of files) {
      await mkdir(dirname(join(dir, file)), { recursive: true });
      await writeFile(join(dir, file), `// ${flowId}\n`);
      await git("add", file);
    }
    await git("commit", "-m", flowId);
  }
  await git("checkout", "main");
  return dir;
}

describe("autopilot 敏感路径闸真 git 接线(作者锁定)", () => {
  it("AUTOPILOT_GUARD_KEYS 含 sensitive,构造器返回的闸集合与之相等", async () => {
    const dir = await makeRepo({});
    const guards = buildAutopilotGuards(dir, new FlowTracker(join(dir, ".kunpeng", "state")));
    expect(AUTOPILOT_GUARD_KEYS).toContain("sensitive");
    expect(new Set(Object.keys(guards))).toEqual(new Set(AUTOPILOT_GUARD_KEYS));
    expect(typeof guards.sensitive).toBe("function");
  });

  it("分支改了 orchestrator/src/server/auth.ts → hits 含该文件;只改 lib → hits 为空", async () => {
    const dir = await makeRepo({
      "flow-auth": ["orchestrator/src/server/auth.ts", "lib/i18n.ts"],
      "flow-plain": ["lib/i18n.ts"],
    });
    const guards = buildAutopilotGuards(dir, new FlowTracker(join(dir, ".kunpeng", "state")));
    const hit = await guards.sensitive("flow-auth", "main");
    expect(hit.hits).toEqual([{ file: "orchestrator/src/server/auth.ts", label: "鉴权/授权" }]);
    await expect(guards.sensitive("flow-plain", "main")).resolves.toEqual({ hits: [] });
  });

  it("分支不存在 → 抛错(交给 autopilot 的保守分支保留门)", async () => {
    const dir = await makeRepo({});
    const guards = buildAutopilotGuards(dir, new FlowTracker(join(dir, ".kunpeng", "state")));
    await expect(guards.sensitive("no-such-flow", "main")).rejects.toThrow();
  });

  it("端到端:真 tracker + 真闸,敏感流被打标留门、普通流照常进 merge", async () => {
    const dir = await makeRepo({
      "flow-auth": ["orchestrator/src/server/auth.ts"],
      "flow-plain": ["lib/i18n.ts"],
    });
    const tracker = new FlowTracker(join(dir, ".kunpeng", "state"), () => 42);
    for (const flowId of ["flow-auth", "flow-plain"]) {
      await tracker.start(flowId, `需求 ${flowId}`);
      await tracker.finish(flowId, "verified", { gate: "合并主干 (人工门#1)", what: `kp/${flowId} → main` });
    }
    const merged: string[] = [];
    const logs: string[] = [];
    const guards = buildAutopilotGuards(dir, tracker);

    const result = await runAutopilot({
      tracker,
      merge: async (flowId) => { merged.push(flowId); return { ok: true }; },
      log: (line) => { logs.push(line); },
      futile: guards.futile,
      discard: guards.discard,
      sensitive: guards.sensitive,
      // preReview 要起 CLI,本测试不接;publicSurface 无配置文件即不命中,照接。
      publicSurface: guards.publicSurface,
    });

    expect(merged).toEqual(["flow-plain"]);
    expect(result.merged).toEqual(["flow-plain"]);
    expect(result.skipped).toEqual([{ flowId: "flow-auth", reason: "敏感路径改动需人工合并：鉴权/授权" }]);
    expect(logs.some((line) => line.includes("flow-auth") && line.includes("鉴权/授权"))).toBe(true);

    const marked = await tracker.read("flow-auth");
    expect(marked?.sensitive).toEqual({ hits: [{ file: "orchestrator/src/server/auth.ts", label: "鉴权/授权" }], at: 42 });
    expect(marked?.humanGate?.gate).toBe("合并主干 (人工门#1) · 敏感路径改动需人工合并：鉴权/授权");
    expect(marked?.humanGate?.what).toBe("kp/flow-auth → main");
    expect((await tracker.read("flow-plain"))?.sensitive).toBeUndefined();

    // 第二轮:普通流的门已被真 mergeAndClearGate 清掉(这里手工模拟),敏感流已打标,不再跑 git diff,仍被跳过
    await tracker.clearGate("flow-plain");
    const again = await runAutopilot({ tracker, merge: async (flowId) => { merged.push(flowId); return { ok: true }; }, log: () => {}, sensitive: async () => { throw new Error("不该再跑闸"); } });
    expect(again.skipped).toEqual([{ flowId: "flow-auth", reason: "敏感路径改动需人工合并：鉴权/授权" }]);
  });
});