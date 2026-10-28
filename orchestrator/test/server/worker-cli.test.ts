import { describe, expect, test } from "vitest";
import "../../src/cli-commands/worker.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import {
  resolveWorkerConfig,
  parseWorkerArgs,
  type WorkerConfigResult,
} from "../../src/cli-commands/worker.js";

const TOKEN = "w1.acct.machine.123.abcdef";

function resolve(overrides: Record<string, unknown> = {}): WorkerConfigResult {
  return resolveWorkerConfig({
    args: {},
    env: {},
    fileText: null,
    hostname: "my-laptop",
    cwd: "/home/me",
    ...overrides,
  } as never);
}

function ok(result: WorkerConfigResult): { config: { url: string; token: string; machineName: string; root: string }; warnings: string[] } {
  if (!result.ok) throw new Error(`期望成功,实际失败: ${result.error}`);
  return result;
}

describe("命令注册", () => {
  test("worker 命令已注册", () => {
    expect(listCliCommands().map((c) => c.name)).toContain("worker");
  });
});

describe("parseWorkerArgs", () => {
  test("解析 --key value", () => {
    const args = parseWorkerArgs(["--url", "wss://a", "--name", "本本", "--root", "/w"]);
    expect(args.url).toBe("wss://a");
    expect(args.name).toBe("本本");
    expect(args.root).toBe("/w");
  });

  test("缺值的键为 undefined", () => {
    expect(parseWorkerArgs(["--url"]).url).toBeUndefined();
  });

  test("未知键被忽略,不影响已知键", () => {
    const args = parseWorkerArgs(["--nonsense", "x", "--url", "wss://a"]);
    expect(args.url).toBe("wss://a");
  });

  test("空数组不抛", () => {
    expect(() => parseWorkerArgs([])).not.toThrow();
  });
});

describe("URL 协议判定", () => {
  test("wss 任何 host 都放行", () => {
    const r = ok(resolve({ args: { url: "wss://cockpit.example.com/api/worker/connect", token: TOKEN } }));
    expect(r.config.url).toContain("wss://");
  });

  test("http/https 给出明确错误", () => {
    for (const url of ["http://a/x", "https://cockpit.example.com/x"]) {
      const r = resolve({ args: { url, token: TOKEN } });
      expect(r.ok, `${url} 应当被拒`).toBe(false);
    }
  });

  test("完全不是 URL 也被拒", () => {
    expect(resolve({ args: { url: "随便写的", token: TOKEN } }).ok).toBe(false);
  });

  test("缺 url 报错", () => {
    expect(resolve({ args: { token: TOKEN } }).ok).toBe(false);
  });
});

describe("ws:// 明文判定(异地场景的真风险)", () => {
  test("ws 打本机放行", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const r = resolve({ args: { url: `ws://${host}:8080/api/worker/connect`, token: TOKEN } });
      expect(r.ok, `${host} 应当放行`).toBe(true);
    }
  });

  test("ws 打远端默认拒绝", () => {
    const r = resolve({ args: { url: "ws://cockpit.example.com/api/worker/connect", token: TOKEN } });
    expect(r.ok).toBe(false);
  });

  test("--insecure 可放行远端 ws,但必须带明文警告", () => {
    const r = ok(resolve({
      args: { url: "ws://cockpit.example.com/api/worker/connect", token: TOKEN },
      insecure: true,
    }));
    expect(r.warnings.join("|")).toContain("明文");
  });

  test("本机 ws 不该有明文警告(没风险就别吓人)", () => {
    const r = ok(resolve({ args: { url: "ws://127.0.0.1:9/api/worker/connect", token: TOKEN } }));
    expect(r.warnings.join("|")).not.toContain("明文");
  });
});

describe("token 来源优先级:文件 > 环境变量 > 命令行", () => {
  test("文件优先于环境变量与命令行", () => {
    const r = ok(resolve({
      args: { url: "wss://a/x", token: "w1.from.args.1.aa" },
      env: { KUNPENG_WORKER_TOKEN: "w1.from.env.1.bb" },
      fileText: JSON.stringify({ token: "w1.from.file.1.cc" }),
    }));
    expect(r.config.token).toBe("w1.from.file.1.cc");
  });

  test("环境变量优先于命令行", () => {
    const r = ok(resolve({
      args: { url: "wss://a/x", token: "w1.from.args.1.aa" },
      env: { KUNPENG_WORKER_TOKEN: "w1.from.env.1.bb" },
    }));
    expect(r.config.token).toBe("w1.from.env.1.bb");
  });

  test("只有命令行时可用,但必须警告会被 ps 看见", () => {
    const r = ok(resolve({ args: { url: "wss://a/x", token: TOKEN } }));
    expect(r.config.token).toBe(TOKEN);
    expect(r.warnings.join("|")).toContain("ps");
  });

  test("token 来自环境变量时不该有 ps 警告", () => {
    const r = ok(resolve({ args: { url: "wss://a/x" }, env: { KUNPENG_WORKER_TOKEN: TOKEN } }));
    expect(r.warnings.join("|")).not.toContain("ps");
  });

  test("缺 token 报错", () => {
    expect(resolve({ args: { url: "wss://a/x" } }).ok).toBe(false);
  });

  test("token 格式不对报错", () => {
    for (const bad of ["v2.a.b.c.d", "随便一串", "w2.a.b.c.d", ""]) {
      const r = resolve({ args: { url: "wss://a/x", token: bad } });
      expect(r.ok, `token=${JSON.stringify(bad)} 应当被拒`).toBe(false);
    }
  });
});

describe("配置文件", () => {
  test("非法 JSON 报错且信息含「配置文件」", () => {
    const r = resolve({ args: { url: "wss://a/x", token: TOKEN }, fileText: "{ 这不是 json" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("配置文件");
  });

  test("没有配置文件不报错", () => {
    for (const fileText of [null, undefined, ""]) {
      expect(resolve({ args: { url: "wss://a/x", token: TOKEN }, fileText }).ok).toBe(true);
    }
  });

  test("文件可提供 url", () => {
    const r = ok(resolve({ args: {}, fileText: JSON.stringify({ url: "wss://f/x", token: TOKEN }) }));
    expect(r.config.url).toBe("wss://f/x");
  });
});

describe("machineName 与 root 的回落链", () => {
  test("machineName:args → 文件 → hostname → 默认", () => {
    const base = { url: "wss://a/x", token: TOKEN };
    expect(ok(resolve({ args: { ...base, name: "甲" }, fileText: JSON.stringify({ machineName: "乙" }) })).config.machineName).toBe("甲");
    expect(ok(resolve({ args: base, fileText: JSON.stringify({ machineName: "乙" }) })).config.machineName).toBe("乙");
    expect(ok(resolve({ args: base })).config.machineName).toBe("my-laptop");
    expect(ok(resolve({ args: base, hostname: undefined })).config.machineName).toBe("工作机");
  });

  test("root:args → 文件 → cwd → 默认", () => {
    const base = { url: "wss://a/x", token: TOKEN };
    expect(ok(resolve({ args: { ...base, root: "/a" }, fileText: JSON.stringify({ root: "/b" }) })).config.root).toBe("/a");
    expect(ok(resolve({ args: base, fileText: JSON.stringify({ root: "/b" }) })).config.root).toBe("/b");
    expect(ok(resolve({ args: base })).config.root).toBe("/home/me");
    expect(ok(resolve({ args: base, cwd: undefined })).config.root).toBe(".");
  });
});

describe("纯函数性", () => {
  test("同样入参多次调用结果一致", () => {
    const input = { args: { url: "wss://a/x", token: TOKEN } };
    expect(resolve(input)).toEqual(resolve(input));
  });

  test("不读 process.env(把真实环境变量塞进去也不受影响)", () => {
    const saved = process.env.KUNPENG_WORKER_TOKEN;
    process.env.KUNPENG_WORKER_TOKEN = "w1.污染.环境.1.zz";
    try {
      const r = ok(resolve({ args: { url: "wss://a/x", token: TOKEN } }));
      expect(r.config.token).toBe(TOKEN);
    } finally {
      if (saved === undefined) delete process.env.KUNPENG_WORKER_TOKEN;
      else process.env.KUNPENG_WORKER_TOKEN = saved;
    }
  });
});