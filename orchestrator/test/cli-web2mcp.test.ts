import { expect, test, describe, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { runWeb2Mcp } from "../src/web2mcp/run.js";
import type { ActionDiscoverer, ActionSpec } from "../src/web2mcp/types.js";

// CLI web2mcp 路径：注入 fake discoverer，不开真浏览器。
function fakeDiscoverer(specs: ActionSpec[]): ActionDiscoverer {
  return { async discover() { return specs; } };
}

const FORM_SPEC: ActionSpec = {
  id: "f1", kind: "form", title: "login", target: { url: "https://x/login", method: "POST" },
  params: [{ name: "user", type: "string", required: true, in: "form" }], needsAuth: false,
};
const NET_SPEC: ActionSpec = {
  id: "n1", kind: "network", title: "search", target: { url: "https://x/api/search", method: "POST" },
  params: [{ name: "q", type: "string", required: true, in: "body" }], needsAuth: true,
};

describe("runWeb2Mcp", () => {
  let out: string;
  beforeEach(async () => { out = await fs.mkdtemp(path.join(os.tmpdir(), "web2mcp-")); });
  afterEach(async () => { await fs.rm(out, { recursive: true, force: true }); });

  test("发现动作→生成 MCP 工程，tools>0，产物齐全", async () => {
    const res = await runWeb2Mcp({
      url: "https://x", outDir: out,
      discoverers: [fakeDiscoverer([FORM_SPEC]), fakeDiscoverer([NET_SPEC])],
    });
    expect(res.tools).toBe(2);
    const files = await fs.readdir(out);
    expect(files).toContain("server.ts");
    expect(files).toContain("package.json");
    const pkg = JSON.parse(await fs.readFile(path.join(out, "package.json"), "utf8"));
    expect(pkg.dependencies).toHaveProperty("@modelcontextprotocol/sdk");
  });

  test("跨 discoverer 去重（同 method+url）", async () => {
    const res = await runWeb2Mcp({
      url: "https://x", outDir: out,
      discoverers: [fakeDiscoverer([NET_SPEC]), fakeDiscoverer([NET_SPEC])],
    });
    expect(res.tools).toBe(1);
  });

  test("0 动作 → 抛清晰错误（两层验证硬门）", async () => {
    await expect(runWeb2Mcp({
      url: "https://x", outDir: out, discoverers: [fakeDiscoverer([])],
    })).rejects.toThrow(/未发现可执行动作/);
  });

  test("默认按 discover 构造 discoverer（不注入时用真类，但此处只验 both 选两个）", async () => {
    // 不注入 discoverers，传 fake pageProvider 给真 discoverer，避免开浏览器
    const fakePage = {
      async open() {
        return {
          async forms() { return [{ action: "https://x/login", method: "POST", fields: [{ name: "user", type: "text", required: true }] }]; },
          async capturedRequests() { return [{ method: "POST", url: "https://x/api/s", postData: "{\"q\":1}", resourceType: "fetch" }]; },
          async close() {},
        };
      },
    };
    const res = await runWeb2Mcp({ url: "https://x", outDir: out, discover: "both", pageProvider: fakePage });
    expect(res.tools).toBe(2); // 1 form + 1 network
  });
});
