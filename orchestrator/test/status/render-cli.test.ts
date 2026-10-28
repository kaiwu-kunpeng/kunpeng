import { expect, test } from "vitest";
import { renderModuleStatusCli } from "../../src/status/render-cli.js";
import type { ModuleStatusReport } from "../../src/status/types.js";

test("renderModuleStatusCli 渲染 rollup、分组、活动、心跳和生成时间", () => {
  const generatedAt = 1_800_000_000_000;
  const report: ModuleStatusReport = {
    generatedAt,
    rollup: { green: 1, yellow: 1, red: 1, idle: 1 },
    modules: [
      {
        id: "dev-cycle",
        name: "核心研发循环",
        category: "research-loop",
        light: "green",
        wired: true,
        lastActivity: { at: generatedAt - 60_000, agoText: "1 分钟前", summary: "最近 verified", ok: true },
      },
      {
        id: "switchboard",
        name: "跨实例通讯",
        category: "comms",
        light: "yellow",
        wired: true,
        heartbeat: { online: true, detail: "switchboard dir exists" },
        note: "2 条未读",
      },
      {
        id: "merge-gate",
        name: "合并前审查闸",
        category: "governance",
        light: "red",
        wired: false,
        heartbeat: { online: false, detail: "missing" },
      },
      {
        id: "serve",
        name: "总控台服务",
        category: "platform",
        light: "idle",
        wired: true,
      },
    ],
  };

  const text = renderModuleStatusCli(report);

  expect(text).toContain("鲲鹏模块状态");
  expect(text).toContain("🟢1");
  expect(text).toContain("🟡1");
  expect(text).toContain("🔴1");
  expect(text).toContain("⚪1");
  expect(text).toContain("共4个模块");
  expect(text).toContain("研发循环");
  expect(text).toContain("通讯");
  expect(text).toContain("治理");
  expect(text).toContain("平台");
  expect(text).toContain("核心研发循环");
  expect(text).toContain("跨实例通讯");
  expect(text).toContain("合并前审查闸");
  expect(text).toContain("总控台服务");
  expect(text).toContain("1 分钟前");
  expect(text).toContain("♥在线");
  expect(text).toContain("✘离线");
  expect(text).toContain("生成于 2027-01-15T08:00:00.000Z");
});
