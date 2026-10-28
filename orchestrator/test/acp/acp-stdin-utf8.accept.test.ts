import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { runAcpStdio } from "../../src/acp/agent.js";

describe("ACP stdin 多字节字符跨块（作者锁定）", () => {
  test("session/new 的中文 cwd 被切在字节中间，/status 收到的 cwd 仍完整", async () => {
    const input = new PassThrough();
    const seen: string[] = [];
    const output = { write: (_chunk: string) => true };
    const done = runAcpStdio(input, output, {
      version: "1.0.0",
      listFlows: async (cwd) => { seen.push(cwd); return []; },
      dispatch: async () => ({ pid: 0, logPath: "" }),
      newSessionId: () => "s1",
    });
    const cwd = "/Users/某人/项目一/鲲鹏";
    const init = `${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: 1 } })}\n`;
    const session = Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd, mcpServers: [] } })}\n`, "utf8");
    const cut = session.indexOf(Buffer.from("项", "utf8")) + 1;
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    input.write(Buffer.from(init, "utf8"));
    await flush();
    input.write(session.subarray(0, cut));
    await flush();
    input.write(session.subarray(cut));
    await flush();
    const promptMsg = Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/prompt", params: { sessionId: "s1", prompt: [{ type: "text", text: "/status" }] } })}\n`, "utf8");
    for (const byte of promptMsg) {
      input.write(Buffer.from([byte]));
      await flush();
    }
    input.end();
    await done;
    expect(seen).toEqual([cwd]);
  });
});