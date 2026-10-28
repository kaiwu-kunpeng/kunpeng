import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { handleCodegraphMcp } from "../../src/codegraph/mcp-server.js";
import { CodeGraphStore } from "../../src/codegraph/store.js";
import {
  DEFAULT_LEGACY_VERSION,
  MODERN_PROTOCOL_VERSION,
  negotiateLegacyVersion,
  preflightMcp,
  UNSUPPORTED_PROTOCOL_VERSION_CODE,
} from "../../src/mcp/protocol-era.js";
import { handleSeoMcp } from "../../src/seo/mcp-server.js";
import { handleLocalFsMcpRequest } from "../../src/server/localfs/mcp-server.js";
import { handleWorkerMcpRequest } from "../../src/server/worker/mcp-server.js";
import { handleMcpRequest } from "../../src/switchboard/mcp-server.js";
import { TaskStore } from "../../src/switchboard/task-store.js";

type Rpc = { jsonrpc: "2.0"; id: number; method: string; params?: unknown };
type Reply = { result?: Record<string, unknown>; error?: { code: number; message: string; data?: Record<string, unknown> } };

const MODERN_META = { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION } };
const BAD_META = { _meta: { "io.modelcontextprotocol/protocolVersion": "1900-01-01" } };

const SERVERS: Array<{ name: string; call: (req: Rpc) => Promise<unknown> }> = [
  { name: "kunpeng-codegraph", call: async (req) => handleCodegraphMcp(req as never, { store: new CodeGraphStore() }) },
  {
    name: "kunpeng-seo",
    call: (req) => handleSeoMcp(req as never, {
      tools: [],
      context: { repoRoot: "/tmp/demo-repo", fetchImpl: fetch, now: () => 0 } as never,
    }),
  },
  {
    name: "kunpeng-switchboard",
    call: (req) => handleMcpRequest(req as never, { taskStore: new TaskStore(mkdtempSync(join(tmpdir(), "kp-era-sb-"))) }),
  },
  {
    name: "kunpeng-worker",
    call: (req) => handleWorkerMcpRequest(JSON.stringify(req), {
      execUrl: "http://127.0.0.1:9/exec", fsUrl: "http://127.0.0.1:9/fs", machineId: "m1", conv: "c1",
    }),
  },
  {
    name: "kunpeng-localfs",
    call: (req) => handleLocalFsMcpRequest(JSON.stringify(req), "http://127.0.0.1:9/enqueue", "c1"),
  },
];

const rpc = (method: string, params?: unknown): Rpc => ({ jsonrpc: "2.0", id: 7, method, ...(params === undefined ? {} : { params }) });
const send = async (call: (req: Rpc) => Promise<unknown>, method: string, params?: unknown): Promise<Reply> =>
  (await call(rpc(method, params))) as Reply;

describe("协议判定（作者锁定）", () => {
  test("老客户端要的老版本原样回，没说或不认识就回退 2024-11-05", () => {
    expect(negotiateLegacyVersion("2025-06-18")).toBe("2025-06-18");
    expect(negotiateLegacyVersion("2024-11-05")).toBe("2024-11-05");
    expect(negotiateLegacyVersion(undefined)).toBe(DEFAULT_LEGACY_VERSION);
    expect(negotiateLegacyVersion("2099-01-01")).toBe("2024-11-05");
  });

  test("普通老式请求不拦截，交回各 server 自己分派", () => {
    expect(preflightMcp("tools/list", undefined, { name: "x", version: "1" })).toBeNull();
    expect(preflightMcp("tools/call", { name: "t" }, { name: "x", version: "1" })).toBeNull();
    expect(preflightMcp("tools/list", MODERN_META, { name: "x", version: "1" })).toBeNull();
  });
});

describe.each(SERVERS)("$name：MCP 双代兼容（作者锁定）", ({ name, call }) => {
  test("老客户端 initialize 2024-11-05 → 行为与升级前一致", async () => {
    const r = await send(call, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "c", version: "1" } });
    expect(r.result?.protocolVersion).toBe("2024-11-05");
    expect((r.result?.serverInfo as { name: string }).name).toBe(name);
    expect(r.result?.capabilities).toMatchObject({ tools: {} });
  });

  test("老客户端 initialize 2025-06-18 → 原样协商", async () => {
    const r = await send(call, "initialize", { protocolVersion: "2025-06-18" });
    expect(r.result?.protocolVersion).toBe("2025-06-18");
  });

  test("server/discover → 列出 2026-07-28 与老版本，并带 serverInfo", async () => {
    const r = await send(call, "server/discover", MODERN_META);
    expect(r.error).toBeUndefined();
    expect(r.result?.resultType).toBe("complete");
    expect(r.result?.supportedVersions).toEqual(expect.arrayContaining(["2026-07-28", "2024-11-05"]));
    expect(r.result?.capabilities).toMatchObject({ tools: {} });
    const meta = r.result?._meta as Record<string, { name: string }>;
    expect(meta["io.modelcontextprotocol/serverInfo"].name).toBe(name);
  });

  test("新式 tools/list 附缓存提示；老式 tools/list 不附", async () => {
    const modern = await send(call, "tools/list", MODERN_META);
    expect(Array.isArray(modern.result?.tools)).toBe(true);
    expect(modern.result?.ttlMs).toBe(300_000);
    expect(modern.result?.cacheScope).toBe("public");
    expect(modern.result?.resultType).toBe("complete");
    const legacy = await send(call, "tools/list");
    expect(Array.isArray(legacy.result?.tools)).toBe(true);
    expect(legacy.result).not.toHaveProperty("ttlMs");
    expect(legacy.result).not.toHaveProperty("resultType");
  });

  test("新式 tools/call 结果带 resultType；老式不带", async () => {
    const modern = await send(call, "tools/call", { ...MODERN_META, name: "__no_such_tool__", arguments: {} });
    if (modern.result) expect(modern.result.resultType).toBe("complete");
    const legacy = await send(call, "tools/call", { name: "__no_such_tool__", arguments: {} });
    if (legacy.result) expect(legacy.result).not.toHaveProperty("resultType");
  });

  test("请求了不支持的版本 → -32022 并列出支持的版本", async () => {
    const r = await send(call, "tools/list", BAD_META);
    expect(r.result).toBeUndefined();
    expect(r.error?.code).toBe(UNSUPPORTED_PROTOCOL_VERSION_CODE);
    expect(r.error?.code).toBe(-32022);
    expect(r.error?.data?.requested).toBe("1900-01-01");
    expect(r.error?.data?.supported).toEqual(expect.arrayContaining(["2026-07-28"]));
  });
});