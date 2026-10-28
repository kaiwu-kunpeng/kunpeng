import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { autoMergeVerdict, runAutopilot, type AutopilotDeps } from "../../src/loop/autopilot.js";
import { classifySensitiveFiles, SENSITIVE_GATE_NOTE, type SensitiveHit } from "../../src/runtime/sensitive-paths.js";

const TEXT_THAT_USED_TO_TRIP = "更新 constitution 宪法条款，轮换 credential 凭证，drop table，rm -rf，改 launchd crontab";

function harness(sensitiveHits?: SensitiveHit[]) {
  const merged: string[] = [];
  const marked: [string, SensitiveHit[]][] = [];
  const logs: string[] = [];
  const flows = [{ flowId: "f1", status: "verified", requirement: TEXT_THAT_USED_TO_TRIP, humanGate: { gate: "合并主干 (人工门#1)", what: "kp/f1 → main" } }];
  const deps: AutopilotDeps = {
    tracker: { list: async () => flows, markSensitive: async (id: string, hits: SensitiveHit[]) => { marked.push([id, hits]); } } as unknown as AutopilotDeps["tracker"],
    merge: async (flowId) => { merged.push(flowId); return { ok: true }; },
    log: (line) => { logs.push(line); },
  };
  if (sensitiveHits) deps.sensitive = async () => ({ hits: sensitiveHits });
  return { deps, merged, marked, logs };
}

describe("autopilot 敏感判定只看 diff 文件列表（作者锁定）", () => {
  it("autoMergeVerdict 按文件列表：控制面/守门器源码拦，普通源码放", () => {
    const hooks = autoMergeVerdict([".kunpeng/hooks.json"]);
    expect(hooks.auto).toBe(false);
    expect(hooks.reason).toContain(SENSITIVE_GATE_NOTE);
    expect(hooks.reason).toContain("闸门控制面");
    expect(hooks.hits).toHaveLength(1);
    const guard = autoMergeVerdict(["orchestrator/src/runtime/sensitive-paths.ts"]);
    expect(guard.auto).toBe(false);
    expect(guard.reason).toContain("守门器源码");
    expect(autoMergeVerdict(["orchestrator/src/server/chat-usage.ts"])).toEqual({ auto: true, hits: [] });
    expect(autoMergeVerdict([]).auto).toBe(true);
  });

  it("需求文本里塞满旧的 13 个子串、diff 干净 → 照常自动合并（文本不再是判据）", async () => {
    const h = harness([]);
    const r = await runAutopilot(h.deps);
    expect(h.merged).toEqual(["f1"]);
    expect(r.skipped).toEqual([]);
  });

  it("必先红 ①：改 .kunpeng/hooks.json 的流不得自动合并，打标 sensitive、理由带标签", async () => {
    const h = harness(classifySensitiveFiles([".kunpeng/hooks.json", "orchestrator/src/x.ts"]).hits);
    const r = await runAutopilot(h.deps);
    expect(h.merged).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.reason).toContain("闸门控制面");
    expect(h.marked).toHaveLength(1);
    expect(h.marked[0]![1][0]).toEqual({ file: ".kunpeng/hooks.json", label: "闸门控制面" });
  });

  it("必先红 ③：改 sensitive-paths.ts 本身的流保留人工门", async () => {
    const h = harness(classifySensitiveFiles(["orchestrator/src/runtime/sensitive-paths.ts"]).hits);
    const r = await runAutopilot(h.deps);
    expect(h.merged).toEqual([]);
    expect(r.skipped[0]!.reason).toContain("守门器源码");
  });

  it("sensitive 闸缺失时打一行告警但不改行为", async () => {
    const h = harness();
    await runAutopilot(h.deps);
    expect(h.logs.some((l) => l.includes("敏感路径闸未接线"))).toBe(true);
    expect(h.merged).toEqual(["f1"]);
  });

  it("源码里不再有需求文本子串判定", () => {
    const text = readFileSync(fileURLToPath(new URL("../../src/loop/autopilot.ts", import.meta.url)), "utf8");
    expect(text).not.toContain("SENSITIVE_MERGE_PATTERNS");
    expect(text).not.toContain("drop table");
    expect(text).not.toContain("requirement.toLowerCase()");
    expect(text).toContain("classifySensitiveFiles");
  });
});