import { describe, expect, test } from "vitest";
import {
  handleWorkerMcpRequest,
  workerToolSpec,
} from "../../src/server/worker/mcp-server.js";
import { WORKER_TOOLS } from "../../src/server/worker/tool-surface.js";

const MACHINE = "0123456789abcdef0123456789abcdef";

interface Captured { url: string; init: RequestInit }

function fakeFetch(
  response: unknown,
  status = 200,
  captured?: Captured[],
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    captured?.push({ url: String(url), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
      text: async () => JSON.stringify(response),
    };
  }) as unknown as typeof fetch;
}

function deps(overrides: Record<string, unknown> = {}): never {
  return {
    execUrl: "http://127.0.0.1:9/api/worker/exec",
    machineId: MACHINE,
    conv: "conv-1",
    fetchImpl: fakeFetch({ stdout: "", stderr: "", exitCode: 0, truncated: false, timedOut: false, execId: "e1" }),
    ...overrides,
  } as never;
}

function rpc(method: string, params?: unknown, id: unknown = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function asResult(value: unknown): Record<string, unknown> {
  const obj = value as { result?: Record<string, unknown> };
  if (!obj.result) throw new Error(`期望 result,实际: ${JSON.stringify(value)}`);
  return obj.result;
}

function asError(value: unknown): { code: number; message: string } {
  const obj = value as { error?: { code: number; message: string } };
  if (!obj.error) throw new Error(`期望 error,实际: ${JSON.stringify(value)}`);
  return obj.error;
}

describe("协议基本面", () => {
  test("initialize 的 serverInfo 是 kunpeng-worker", async () => {
    const result = asResult(await handleWorkerMcpRequest(rpc("initialize"), deps()));
    expect((result.serverInfo as { name: string }).name).toBe("kunpeng-worker");
    expect(result.capabilities).toBeDefined();
  });

  test("畸形 JSON → -32700", async () => {
    expect(asError(await handleWorkerMcpRequest("{ 这不是 json", deps())).code).toBe(-32700);
  });

  test("通知(无 id)→ null,不回", async () => {
    expect(await handleWorkerMcpRequest(
      JSON.stringify({ jsonrpc: "2.0", method: "initialized" }), deps(),
    )).toBeNull();
  });

  test("未知 method → -32601", async () => {
    expect(asError(await handleWorkerMcpRequest(rpc("nope/nope"), deps())).code).toBe(-32601);
  });

  test("任何异常都不逃出去", async () => {
    const broken = deps({ fetchImpl: () => { throw new Error("网络炸了"); } });
    const out = await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_exec", arguments: { command: "x" } }), broken,
    );
    expect(asError(out).code).toBe(-32000);
  });
});

describe("tools/list", () => {
  test("恰好七个,集合与 WORKER_TOOLS 相同", async () => {
    const result = asResult(await handleWorkerMcpRequest(rpc("tools/list"), deps()));
    const tools = result.tools as Array<{ name: string }>;
    expect(tools.length).toBe(7);
    expect(tools.map((t) => t.name).sort()).toEqual([...WORKER_TOOLS].sort());
  });

  test("描述里写明是异地工作机而不是本机", async () => {
    const result = asResult(await handleWorkerMcpRequest(rpc("tools/list"), deps()));
    const tools = result.tools as Array<{ description: string }>;
    for (const tool of tools) {
      expect(tool.description).toContain("工作机");
    }
  });
});

describe("workerToolSpec 的 inputSchema", () => {
  test("ws_exec 必填 command", () => {
    const spec = workerToolSpec("ws_exec") as { inputSchema: { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> } };
    expect(spec.inputSchema.required).toContain("command");
    expect(spec.inputSchema.properties.timeoutMs).toBeDefined();
    expect(spec.inputSchema.additionalProperties).toBe(false);
  });

  test("ws_write 必填 path 与 content", () => {
    const spec = workerToolSpec("ws_write") as { inputSchema: { required: string[] } };
    expect([...spec.inputSchema.required].sort()).toEqual(["content", "path"]);
  });

  test("ws_list 有可选 recursive", () => {
    const spec = workerToolSpec("ws_list") as { inputSchema: { required: string[]; properties: Record<string, unknown> } };
    expect(spec.inputSchema.required).toEqual(["path"]);
    expect(spec.inputSchema.properties.recursive).toBeDefined();
  });

  test("六个文件工具都必填 path 且禁止多余字段", () => {
    for (const name of ["ws_read", "ws_stat", "ws_delete", "ws_mkdir", "ws_list", "ws_write"] as const) {
      const spec = workerToolSpec(name) as { inputSchema: { required: string[]; additionalProperties: boolean } };
      expect(spec.inputSchema.required, name).toContain("path");
      expect(spec.inputSchema.additionalProperties, name).toBe(false);
    }
  });
});

describe("ws_exec 走 /api/worker/exec", () => {
  test("machineId / command / conv 都正确发出去", async () => {
    const captured: Captured[] = [];
    const d = deps({
      fetchImpl: fakeFetch({ stdout: "hi\n", stderr: "", exitCode: 0, truncated: false, timedOut: false, execId: "e1" }, 200, captured),
    });
    await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_exec", arguments: { command: "echo hi", timeoutMs: 5000 } }), d,
    );
    expect(captured.length).toBe(1);
    const sent = JSON.parse(String(captured[0].init.body)) as Record<string, unknown>;
    expect(sent.machineId).toBe(MACHINE);
    expect(sent.command).toBe("echo hi");
    expect(sent.timeoutMs).toBe(5000);
    expect(sent.conv).toBe("conv-1");
  });

  test("结果格式化进 tool response,含 exit code 与 stdout", async () => {
    const d = deps({
      fetchImpl: fakeFetch({ stdout: "输出内容\n", stderr: "", exitCode: 0, truncated: false, timedOut: false, execId: "e1" }),
    });
    const result = asResult(await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_exec", arguments: { command: "echo x" } }), d,
    ));
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("输出内容");
    expect(text).toContain("0");
    expect(result.isError).toBe(false);
  });

  test("退出码非 0 → isError 为真", async () => {
    const d = deps({
      fetchImpl: fakeFetch({ stdout: "", stderr: "报错了", exitCode: 3, truncated: false, timedOut: false, execId: "e1" }),
    });
    const result = asResult(await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_exec", arguments: { command: "false" } }), d,
    ));
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("报错了");
  });

  test("超时 → isError 为真且文本写明超时", async () => {
    const d = deps({
      fetchImpl: fakeFetch({ stdout: "半截", stderr: "", exitCode: null, truncated: false, timedOut: true, execId: "e1" }),
    });
    const result = asResult(await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_exec", arguments: { command: "sleep 999" } }), d,
    ));
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("超时");
  });

  test("截断要写明", async () => {
    const d = deps({
      fetchImpl: fakeFetch({ stdout: "很长", stderr: "", exitCode: 0, truncated: true, timedOut: false, execId: "e1" }),
    });
    const result = asResult(await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_exec", arguments: { command: "cat big" } }), d,
    ));
    expect((result.content as Array<{ text: string }>)[0].text).toContain("截断");
  });

  test("HTTP 非 2xx → 错误且带状态码", async () => {
    const d = deps({ fetchImpl: fakeFetch({ error: "该工作机不在线" }, 404) });
    const err = asError(await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_exec", arguments: { command: "x" } }), d,
    ));
    expect(err.code).toBe(-32000);
    expect(err.message).toContain("404");
  });

  test("空 command 被 toolToWorkerOp 拦下,且不发 HTTP", async () => {
    const captured: Captured[] = [];
    const d = deps({ fetchImpl: fakeFetch({}, 200, captured) });
    const err = asError(await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_exec", arguments: { command: "   " } }), d,
    ));
    expect(err.code).toBe(-32000);
    expect(captured.length).toBe(0);
  });
});

describe("安全", () => {
  test("路径越权被拦下且不发 HTTP", async () => {
    for (const path of ["../etc/passwd", "/etc/passwd", "C:\\Windows", "a/../../b"]) {
      const captured: Captured[] = [];
      const d = deps({ fetchImpl: fakeFetch({}, 200, captured) });
      const out = await handleWorkerMcpRequest(
        rpc("tools/call", { name: "ws_read", arguments: { path } }), d,
      );
      expect(asError(out).code, path).toBe(-32000);
      expect(captured.length, `${path} 不该发出请求`).toBe(0);
    }
  });

  test("未知工具名 → 错误", async () => {
    const err = asError(await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_bogus", arguments: {} }), deps(),
    ));
    expect(err.code).toBe(-32000);
  });

  test("tools/call 缺 name → 错误", async () => {
    expect(asError(await handleWorkerMcpRequest(rpc("tools/call", { arguments: {} }), deps())).code).toBe(-32000);
  });

  test("token 不出现在任何响应里", async () => {
    const token = "v2.secret.session.token.zzz";
    const d = deps({ token, fetchImpl: fakeFetch({ error: "boom" }, 500) });
    const out = await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_exec", arguments: { command: "x" } }), d,
    );
    expect(JSON.stringify(out)).not.toContain(token);
  });

  test("带 token 时以 cookie 头发出,不进 URL", async () => {
    const captured: Captured[] = [];
    const token = "v2.a.b.c.d";
    const d = deps({ token, fetchImpl: fakeFetch({ stdout: "", stderr: "", exitCode: 0, truncated: false, timedOut: false, execId: "e" }, 200, captured) });
    await handleWorkerMcpRequest(rpc("tools/call", { name: "ws_exec", arguments: { command: "x" } }), d);
    expect(captured[0].url).not.toContain(token);
    expect(JSON.stringify(captured[0].init.headers)).toContain(token);
  });
});

describe("文件工具走 /api/worker/fs", () => {
  test("六个文件工具都发到 fsUrl,不再是「尚未接线」", async () => {
    for (const name of ["ws_read", "ws_write", "ws_list", "ws_stat", "ws_delete", "ws_mkdir"]) {
      const args: Record<string, unknown> = { path: "a.txt" };
      if (name === "ws_write") args.content = "x";
      const captured: Captured[] = [];
      const d = deps({
        fsUrl: "http://127.0.0.1:9/api/worker/fs",
        fetchImpl: fakeFetch({ ok: true, data: "内容", timedOut: false, opId: "o1" }, 200, captured),
      });
      const out = await handleWorkerMcpRequest(rpc("tools/call", { name, arguments: args }), d);
      const result = asResult(out);
      expect(result.isError, name).toBe(false);
      expect(captured.length, name).toBe(1);
      expect(captured[0].url, name).toContain("/api/worker/fs");
      const sent = JSON.parse(String(captured[0].init.body)) as Record<string, unknown>;
      expect(sent.machineId, name).toBe(MACHINE);
      expect(String(sent.kind), name).toBe(name.replace("ws_", ""));
      expect(sent.path, name).toBe("a.txt");
    }
  });

  test("ws_write 把 content 带过去", async () => {
    const captured: Captured[] = [];
    const d = deps({
      fsUrl: "http://127.0.0.1:9/api/worker/fs",
      fetchImpl: fakeFetch({ ok: true, timedOut: false, opId: "o1" }, 200, captured),
    });
    await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_write", arguments: { path: "a.txt", content: "写入内容" } }), d,
    );
    const sent = JSON.parse(String(captured[0].init.body)) as Record<string, unknown>;
    expect(sent.content).toBe("写入内容");
  });

  test("ws_list 把 recursive 带过去", async () => {
    const captured: Captured[] = [];
    const d = deps({
      fsUrl: "http://127.0.0.1:9/api/worker/fs",
      fetchImpl: fakeFetch({ ok: true, data: "a\nb", timedOut: false, opId: "o1" }, 200, captured),
    });
    await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_list", arguments: { path: ".", recursive: true } }), d,
    );
    const sent = JSON.parse(String(captured[0].init.body)) as Record<string, unknown>;
    expect(sent.recursive).toBe(true);
  });

  test("ok:false 时 isError 为真且带 error", async () => {
    const d = deps({
      fsUrl: "http://127.0.0.1:9/api/worker/fs",
      fetchImpl: fakeFetch({ ok: false, error: "文件不存在", timedOut: false, opId: "o1" }, 200),
    });
    const result = asResult(await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_read", arguments: { path: "无.txt" } }), d,
    ));
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("文件不存在");
  });

  test("超时时 isError 为真且文本写明超时", async () => {
    const d = deps({
      fsUrl: "http://127.0.0.1:9/api/worker/fs",
      fetchImpl: fakeFetch({ ok: false, timedOut: true, error: "文件操作超时", opId: "o1" }, 200),
    });
    const result = asResult(await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_read", arguments: { path: "a.txt" } }), d,
    ));
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("超时");
  });

  test("fsUrl 未配置时显式报错,不得静默成功", async () => {
    const out = await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_read", arguments: { path: "a.txt" } }), deps({ fsUrl: "" }),
    );
    expect(asError(out).code).toBe(-32000);
  });

  test("HTTP 非 2xx → 错误且带状态码", async () => {
    const d = deps({
      fsUrl: "http://127.0.0.1:9/api/worker/fs",
      fetchImpl: fakeFetch({ error: "该工作机不在线" }, 404),
    });
    const err = asError(await handleWorkerMcpRequest(
      rpc("tools/call", { name: "ws_read", arguments: { path: "a.txt" } }), d,
    ));
    expect(err.message).toContain("404");
  });
});