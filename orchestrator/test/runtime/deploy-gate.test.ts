import { describe, expect, test } from "vitest";
import {
  extractPublicRoutes,
  diffPublicSurface,
  parseHold,
  formatGateDecision,
  type PublicRoute,
} from "../../src/runtime/deploy-gate.js";
import "../../src/cli-commands/deploy.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { usageText, SELF_HELP_COMMANDS } from "../../src/cli.js";

const ROUTES_SRC = `
registerModularRoute({
  method: "GET",
  path: "/api/worker/machines",
  handle: () => {},
});
registerModularRoute({
  method: "POST",
  path: "/api/worker/token",
  handle: () => {},
});
`;

const WS_SRC = `
export const WORKER_WS_PATH = "/api/worker/connect";
registerUpgradeRoute(server, { name: "worker", matches: (p) => p === WORKER_WS_PATH, handle });
`;

describe("命令注册", () => {
  test("deploy 命令已注册", () => {
    expect(listCliCommands().map((c) => c.name)).toContain("deploy");
  });

  test("进了用法表与自助 help 名单", () => {
    expect(usageText()).toContain("deploy");
    expect(SELF_HELP_COMMANDS.has("deploy")).toBe(true);
  });

  test("没有误伤既有命令", () => {
    for (const name of ["run", "plan", "serve", "merge", "worker"]) {
      expect(usageText(), name).toContain(name);
    }
  });
});

describe("extractPublicRoutes", () => {
  test("抽得出 HTTP 路由", () => {
    const routes = extractPublicRoutes({ "routes/worker.ts": ROUTES_SRC });
    const paths = routes.filter((r) => r.kind === "http").map((r) => r.path);
    expect(paths).toContain("/api/worker/machines");
    expect(paths).toContain("/api/worker/token");
  });

  test("抽得出 WS 路径", () => {
    const routes = extractPublicRoutes({ "worker-endpoint.ts": WS_SRC });
    expect(routes.some((r) => r.path.includes("/api/worker/connect"))).toBe(true);
  });

  test("去重", () => {
    const routes = extractPublicRoutes({ "a.ts": ROUTES_SRC, "b.ts": ROUTES_SRC });
    const machines = routes.filter((r) => r.path === "/api/worker/machines");
    expect(machines.length).toBe(1);
  });

  test("稳定排序:同样输入两次结果完全一致", () => {
    const a = extractPublicRoutes({ "a.ts": ROUTES_SRC, "b.ts": WS_SRC });
    const b = extractPublicRoutes({ "b.ts": WS_SRC, "a.ts": ROUTES_SRC });
    expect(a).toEqual(b);
  });

  test("空输入 / 无匹配都返回空数组且不抛", () => {
    expect(extractPublicRoutes({})).toEqual([]);
    expect(extractPublicRoutes({ "x.ts": "这里没有任何路由注册" })).toEqual([]);
    expect(() => extractPublicRoutes({ "x.ts": "" })).not.toThrow();
  });
});

describe("diffPublicSurface", () => {
  const a: PublicRoute[] = [{ kind: "http", path: "/api/a" }, { kind: "ws", path: "/ws/x" }];
  const b: PublicRoute[] = [{ kind: "http", path: "/api/a" }, { kind: "http", path: "/api/b" }];

  test("added / removed 正确", () => {
    const d = diffPublicSurface(a, b);
    expect(d.added).toEqual([{ kind: "http", path: "/api/b" }]);
    expect(d.removed).toEqual([{ kind: "ws", path: "/ws/x" }]);
  });

  test("完全相同时两边都空", () => {
    const d = diffPublicSurface(a, a);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  test("空对空", () => {
    expect(diffPublicSurface([], [])).toEqual({ added: [], removed: [] });
  });

  test("从空到有 = 全是新增", () => {
    expect(diffPublicSurface([], b).added.length).toBe(2);
  });
});

describe("parseHold 必须 fail-closed", () => {
  test("空 / null → 不拦", () => {
    expect(parseHold(null).held).toBe(false);
    expect(parseHold("").held).toBe(false);
  });

  test("held:true → 拦,且带 reason 与 at", () => {
    const h = parseHold(JSON.stringify({ held: true, reason: "等我审完", at: 123 }));
    expect(h.held).toBe(true);
    expect(h.reason).toBe("等我审完");
    expect(h.at).toBe(123);
  });

  test("held:false → 不拦", () => {
    expect(parseHold(JSON.stringify({ held: false })).held).toBe(false);
  });

  test("坏 JSON → 拦(绝不能因为文件损坏就放行)", () => {
    for (const bad of ["{ 这不是 json", "[]", "null", "只是一行字"]) {
      const h = parseHold(bad);
      expect(h.held, `输入 ${JSON.stringify(bad)}`).toBe(true);
      expect(String(h.reason)).toContain("损坏");
    }
  });

  test("reason / at 类型不对时省略该字段但仍按 held 处理", () => {
    const h = parseHold(JSON.stringify({ held: true, reason: 42, at: "昨天" }));
    expect(h.held).toBe(true);
    expect(h.reason).not.toBe(42);
    expect(h.at).toBeUndefined();
  });
});

describe("formatGateDecision", () => {
  test("被 hold → 不放行,且输出含原因", () => {
    const d = formatGateDecision({
      held: { held: true, reason: "我要先审" },
      behind: 3,
      added: [],
    });
    expect(d.allow).toBe(false);
    expect(d.lines.join("\n")).toContain("我要先审");
  });

  test("未 hold → 放行", () => {
    expect(formatGateDecision({ held: { held: false }, behind: 0, added: [] }).allow).toBe(true);
  });

  test("落后提交数出现在输出里", () => {
    const d = formatGateDecision({ held: { held: false }, behind: 7, added: [] });
    expect(d.lines.join("\n")).toContain("7");
  });

  test("新增对外端点被逐条列出", () => {
    const d = formatGateDecision({
      held: { held: false },
      behind: 2,
      added: [{ kind: "ws", path: "/api/worker/connect" }, { kind: "http", path: "/api/worker/exec" }],
    });
    const text = d.lines.join("\n");
    expect(text).toContain("/api/worker/connect");
    expect(text).toContain("/api/worker/exec");
  });

  test("没有新增端点时不该凭空造出条目", () => {
    const d = formatGateDecision({ held: { held: false }, behind: 1, added: [] });
    expect(d.lines.join("\n")).not.toContain("undefined");
  });
});

describe("纯函数性", () => {
  test("同样入参多次调用结果一致", () => {
    const input = { "a.ts": ROUTES_SRC };
    expect(extractPublicRoutes(input)).toEqual(extractPublicRoutes(input));
    expect(parseHold("")).toEqual(parseHold(""));
  });

  test("不受 process.env 影响", () => {
    const before = extractPublicRoutes({ "a.ts": ROUTES_SRC });
    const saved = process.env.KUNPENG_DEPLOY_HOLD;
    process.env.KUNPENG_DEPLOY_HOLD = "1";
    try {
      expect(extractPublicRoutes({ "a.ts": ROUTES_SRC })).toEqual(before);
      expect(parseHold(null).held).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.KUNPENG_DEPLOY_HOLD;
      else process.env.KUNPENG_DEPLOY_HOLD = saved;
    }
  });
});