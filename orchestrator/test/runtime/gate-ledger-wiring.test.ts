import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clientScript } from "../../src/server/ui/client.js";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), "utf8");
const BARE_CLEAR = /\.clearGate\(\s*[\w.]+\s*\)/;

describe("每个清门调用方都署名（作者锁定）", () => {
  it.each([
    ["server/routes/gate-actions.ts", ['via: "cockpit-merge"', 'via: "autopilot-api"', "parseDurationTier(body.durationTier)"]],
    ["cli-commands/loop-core.ts", ['via: "autopilot-cli"']],
    ["cli-commands/devcycle.ts", ['via: "cli-merge"']],
    ["server/autopilot-guards.ts", ['via: "autopilot-futile"']],
    ["runtime/reconcile.ts", ['via: "reconcile-ghost"']],
    ["server/routes/gates.ts", ['via: "cockpit-discard"', "parseDurationTier(body.durationTier)"]],
    ["server/tg-webhook.ts", ['via: "telegram"']],
    ["server/workspace-driver-deps.ts", ['via: "workbench"']],
  ] as const)("%s 含署名 %j", (file, needles) => {
    const text = src(file);
    for (const needle of needles) expect(text).toContain(needle);
  });

  it.each(["runtime/reconcile.ts", "server/autopilot-guards.ts", "server/routes/gates.ts", "server/tg-webhook.ts"])(
    "%s 没有不带署名的 clearGate 调用", (file) => { expect(BARE_CLEAR.test(src(file))).toBe(false); });

  it("tg-webhook 批准与驳回两条路都署名 telegram", () => {
    expect(src("server/tg-webhook.ts").split('via: "telegram"').length - 1).toBe(2);
  });

  it("merge-gate 把 opts.clearedBy 传给 clearGate，默认 unknown/merge-gate", () => {
    const text = src("runtime/merge-gate.ts");
    expect(text).toMatch(/clearGate\(flowId,\s*opts\.clearedBy\s*\?\?\s*\{\s*by:\s*"unknown",\s*via:\s*"merge-gate"\s*\}\s*\)/);
  });

  it("gate-stats 命令已注册且在用法字符串里", () => {
    expect(src("cli-commands/reports.ts")).toContain('name: "gate-stats"');
    expect(src("cli.ts")).toContain("gate-stats");
  });

  it("驾驶舱门卡片带三档时长选择并随批准/驳回上送 durationTier", () => {
    const js = clientScript;
    expect(js).toContain("data-gate-tier");
    expect(js).toContain("≤5 分钟");
    expect(js).toContain("5–15 分钟");
    expect(js).toContain(">15 分钟");
    expect(js).toContain("durationTier");
  });
});