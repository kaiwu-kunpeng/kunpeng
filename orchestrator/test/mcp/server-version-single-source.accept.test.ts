import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { handleCodegraphMcp } from "../../src/codegraph/mcp-server.js";
import { CodeGraphStore } from "../../src/codegraph/store.js";
import { handleSeoMcp } from "../../src/seo/mcp-server.js";
import { handleLocalFsMcpRequest } from "../../src/server/localfs/mcp-server.js";
import { handleWorkerMcpRequest } from "../../src/server/worker/mcp-server.js";
import { handleMcpRequest } from "../../src/switchboard/mcp-server.js";
import { TaskStore } from "../../src/switchboard/task-store.js";
import { kunpengVersion } from "../../src/runtime/version.js";

type Rpc = { jsonrpc: "2.0"; id: number; method: string; params?: unknown };
type Reply = { result?: { serverInfo?: { name: string; version: string } } };

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
    call: (req) => handleMcpRequest(req as never, { taskStore: new TaskStore(mkdtempSync(join(tmpdir(), "kp-ver-sb-"))) }),
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

const pkgVersion = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

describe.each(SERVERS)("$name：serverInfo.version 取 package.json 单一来源（作者锁定）", ({ name, call }) => {
  test("initialize 回报的版本等于 package.json 的 version", async () => {
    const r = (await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } })) as Reply;
    expect(r.result?.serverInfo?.name).toBe(name);
    expect(r.result?.serverInfo?.version).toBe(pkgVersion);
    expect(r.result?.serverInfo?.version).toBe(kunpengVersion());
    expect(r.result?.serverInfo?.version).not.toBe("0.1.0");
  });
});