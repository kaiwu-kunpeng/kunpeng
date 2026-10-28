import { describe, expect, test } from "vitest";
import { chatInvocation } from "../../src/server/chat-stream.js";
import { renderShell } from "../../src/server/ui/shell.js";
import {
  HOST_TOOLS_ISOLATED,
  HOST_TOOLS_READONLY,
  resolveHostToolPolicy,
} from "../../src/server/worker/host-permissions.js";

/** 能派子 agent / 排定时任务 / 给别的会话发消息 / 拉延迟工具的内置工具,一个都不许留在受限白名单里。 */
const SPAWNING_TOOLS = [
  "Agent", "Task", "Workflow", "Monitor", "ToolSearch",
  "CronCreate", "SendMessage", "RemoteTrigger", "Bash", "Write", "Edit", "NotebookEdit",
];

describe("受限模式用白名单而不是黑名单", () => {
  test("满血上限 + 满血模式 → 不限制内置工具", () => {
    const policy = resolveHostToolPolicy("full", "full");
    expect(policy.allowTools).toBeNull();
    expect(policy.disallowTools).toEqual([]);
    expect(policy.codexReadOnly).toBe(false);
  });

  test("出差模式 → 只剩只读白名单,且不含任何能派子 agent 的工具", () => {
    const policy = resolveHostToolPolicy("full", "trip");
    expect(policy.allowTools).toEqual(HOST_TOOLS_READONLY);
    for (const tool of SPAWNING_TOOLS) {
      expect(policy.allowTools, `白名单不得含 ${tool}`).not.toContain(tool);
    }
    expect(policy.codexReadOnly).toBe(true);
  });

  test("readonly 上限在任何模式下都收到只读白名单", () => {
    for (const mode of ["full", "intranet", "trip"] as const) {
      expect(resolveHostToolPolicy("readonly", mode).allowTools).toEqual(HOST_TOOLS_READONLY);
    }
  });

  test("isolated 上限连本机的读都不给", () => {
    const policy = resolveHostToolPolicy("isolated", "full");
    expect(policy.allowTools).toEqual(HOST_TOOLS_ISOLATED);
    expect(policy.allowTools).not.toContain("Read");
    expect(policy.allowTools).not.toContain("Glob");
    expect(policy.allowTools).not.toContain("Grep");
  });

  test("未知取值 fail-closed 到最小面", () => {
    expect(resolveHostToolPolicy("乱写" as never, "full").allowTools).toEqual(HOST_TOOLS_ISOLATED);
    expect(resolveHostToolPolicy("full", "乱写" as never).allowTools).toEqual(HOST_TOOLS_ISOLATED);
  });
});

describe("内网模式是纯标记档,不动任何工具权限", () => {
  test("满血上限下,内网与满血逐字段一致", () => {
    expect(resolveHostToolPolicy("full", "intranet")).toEqual(resolveHostToolPolicy("full", "full"));
  });

  test("出网工具一个都不摘:满血上限下不进 disallowTools", () => {
    const policy = resolveHostToolPolicy("full", "intranet");
    expect(policy.allowTools).toBeNull();
    expect(policy.disallowTools).toEqual([]);
  });

  test("和受限上限叠加时,白名单里的出网工具原样保留", () => {
    const policy = resolveHostToolPolicy("readonly", "intranet");
    expect(policy.allowTools).toEqual(HOST_TOOLS_READONLY);
    expect(policy.allowTools).toContain("WebFetch");
    expect(policy.allowTools).toContain("WebSearch");
    expect(policy.allowTools).toContain("Read");
  });

  test("出差档叠内网,仍是出差那套白名单(含出网工具)", () => {
    expect(resolveHostToolPolicy("full", "intranet").allowTools).toBeNull();
    expect(resolveHostToolPolicy("full", "trip").allowTools).toEqual(HOST_TOOLS_READONLY);
  });

  test("六种组合的 disallowTools 恒为空", () => {
    for (const ceiling of ["full", "readonly", "isolated"] as const) {
      for (const mode of ["full", "intranet", "trip"] as const) {
        expect(resolveHostToolPolicy(ceiling, mode).disallowTools, `${ceiling}/${mode}`).toEqual([]);
      }
    }
  });

  test("模块不再导出 NO_NETWORK_TOOLS", async () => {
    const mod = await import("../../src/server/worker/host-permissions.js");
    expect(Object.keys(mod)).not.toContain("NO_NETWORK_TOOLS");
  });
});

describe("参数真的进了命令行", () => {
  test("claude:受限模式带 --tools 且列表就是白名单", () => {
    const inv = chatInvocation("claude-opus-5", [], false, undefined, false, undefined, "act", undefined,
      resolveHostToolPolicy("full", "trip"));
    const at = inv.args.indexOf("--tools");
    expect(at).toBeGreaterThan(-1);
    expect(inv.args[at + 1]).toBe(HOST_TOOLS_READONLY.join(","));
    expect(inv.args).not.toContain("--disallowedTools");
  });

  test("claude:内网模式一个限制参数都不加(与满血同形)", () => {
    const inv = chatInvocation("claude-opus-5", [], false, undefined, false, undefined, "act", undefined,
      resolveHostToolPolicy("full", "intranet"));
    expect(inv.args).not.toContain("--disallowedTools");
    expect(inv.args).not.toContain("--tools");
    expect(inv.args).toContain("bypassPermissions");
  });

  test("claude:满血模式一个限制参数都不加(不回归既有行为)", () => {
    const inv = chatInvocation("claude-opus-5", [], false, undefined, false, undefined, "act", undefined,
      resolveHostToolPolicy("full", "full"));
    expect(inv.args).not.toContain("--tools");
    expect(inv.args).not.toContain("--disallowedTools");
    expect(inv.args).toContain("bypassPermissions");
  });

  test("codex:受限模式退到只读沙箱,满血与内网仍是 bypass", () => {
    const trip = chatInvocation("codex", [], false, undefined, false, undefined, "act", undefined,
      resolveHostToolPolicy("full", "trip"));
    expect(trip.args).toEqual(expect.arrayContaining(["--sandbox", "read-only"]));
    expect(trip.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");

    const full = chatInvocation("codex", [], false, undefined, false, undefined, "act", undefined,
      resolveHostToolPolicy("full", "full"));
    expect(full.args).toContain("--dangerously-bypass-approvals-and-sandbox");

    const intranet = chatInvocation("codex", [], false, undefined, false, undefined, "act", undefined,
      resolveHostToolPolicy("full", "intranet"));
    expect(intranet.args).toContain("--dangerously-bypass-approvals-and-sandbox");
  });
});

describe("顶栏说清每档到底做什么", () => {
  test("三个 option 都带 title 说明", () => {
    const html = renderShell({} as never);
    expect(html).toMatch(/<option value="full" title="[^"]+">满血模式<\/option>/);
    expect(html).toMatch(/<option value="intranet" title="[^"]+">内网模式<\/option>/);
    expect(html).toMatch(/<option value="trip" title="[^"]+">出差模式<\/option>/);
    expect(html).toContain("不是网络隔离");
  });

  test("内网档 title 说的是标记,不再说关工具", () => {
    const html = renderShell({} as never);
    expect(html).toContain("只是个标记");
    expect(html).not.toContain("关掉 WebFetch");
  });
});