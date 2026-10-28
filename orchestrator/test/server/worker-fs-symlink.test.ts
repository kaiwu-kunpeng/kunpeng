import { describe, expect, test, afterEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { mkdtemp, writeFile, mkdir, symlink, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachWorkerWebSocket, WORKER_WS_PATH } from "../../src/server/worker/worker-endpoint.js";
import { createWorkerClient, type WorkerClient } from "../../src/server/worker/worker-client.js";
import { signWorkerToken, newMachineId } from "../../src/server/worker/worker-token.js";
import type { WorkerFsOp } from "../../src/server/worker/tool-surface.js";

const SECRET = "symlink-secret";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    try { await fn(); } catch { /* 清理尽力而为 */ }
  }
});

async function setup(): Promise<{
  endpoint: ReturnType<typeof attachWorkerWebSocket>;
  client: WorkerClient;
  root: string;
  outside: string;
  connId: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "kp-sym-root-"));
  const outside = await mkdtemp(join(tmpdir(), "kp-sym-outside-"));
  await writeFile(join(outside, "机密.txt"), "root 之外的机密", "utf8");
  const server: Server = http.createServer((_req, res) => res.end("ok"));
  const endpoint = attachWorkerWebSocket(server, { resolveSecret: async () => SECRET });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
  const client = createWorkerClient({
    url: `ws://127.0.0.1:${addr.port}${WORKER_WS_PATH}`,
    token: signWorkerToken("acct-1", newMachineId(), SECRET, Date.now()),
    machineName: "软链测试机",
    root,
  });
  cleanups.push(() => client.stop());
  cleanups.push(() => { endpoint.close(); server.close(); });
  client.start();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && endpoint.registry.listByAccount("acct-1").length === 0) {
    await new Promise((r) => setTimeout(r, 25));
  }
  const conn = endpoint.registry.listByAccount("acct-1")[0];
  if (!conn) throw new Error("工作机没连上");
  return { endpoint, client, root, outside, connId: conn.connId };
}

async function run(
  ctx: { endpoint: ReturnType<typeof attachWorkerWebSocket>; connId: string },
  op: WorkerFsOp,
): Promise<{ ok: boolean; data?: string; error?: string; timedOut: boolean }> {
  const { result } = ctx.endpoint.fsQueue.submit("conv-sym", op, { timeoutMs: 8000 });
  const pending = ctx.endpoint.fsQueue.take("conv-sym");
  expect(pending).not.toBeNull();
  expect(ctx.endpoint.dispatchFs(ctx.connId, pending as never)).toBe(true);
  return result;
}

describe("软链越权:四项操作全部必须被拒", () => {
  test("read 穿过软链读 root 外 → 被拒", async () => {
    const ctx = await setup();
    await symlink(ctx.outside, join(ctx.root, "link"));
    const r = await run(ctx, { op: "fs", kind: "read", path: "link/机密.txt" });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(false);
    expect(String(r.data ?? "")).not.toContain("机密");
  }, 30_000);

  test("write 穿过软链写 root 外 → 被拒,且外部文件没被创建", async () => {
    const ctx = await setup();
    await symlink(ctx.outside, join(ctx.root, "link"));
    const r = await run(ctx, { op: "fs", kind: "write", path: "link/不该出现.txt", content: "x" });
    expect(r.ok).toBe(false);
    await expect(stat(join(ctx.outside, "不该出现.txt"))).rejects.toThrow();
  }, 30_000);

  test("delete 穿过软链删 root 外 → 被拒,且外部文件还在", async () => {
    const ctx = await setup();
    await symlink(ctx.outside, join(ctx.root, "link"));
    const r = await run(ctx, { op: "fs", kind: "delete", path: "link/机密.txt" });
    expect(r.ok).toBe(false);
    expect(await readFile(join(ctx.outside, "机密.txt"), "utf8")).toBe("root 之外的机密");
  }, 30_000);

  test("mkdir 穿过软链在 root 外建目录 → 被拒", async () => {
    const ctx = await setup();
    await symlink(ctx.outside, join(ctx.root, "link"));
    const r = await run(ctx, { op: "fs", kind: "mkdir", path: "link/不该出现的目录" });
    expect(r.ok).toBe(false);
    await expect(stat(join(ctx.outside, "不该出现的目录"))).rejects.toThrow();
  }, 30_000);

  test("list 穿过软链列 root 外 → 被拒", async () => {
    const ctx = await setup();
    await symlink(ctx.outside, join(ctx.root, "link"));
    const r = await run(ctx, { op: "fs", kind: "list", path: "link" });
    expect(r.ok).toBe(false);
  }, 30_000);

  test("stat 穿过软链看 root 外 → 被拒", async () => {
    const ctx = await setup();
    await symlink(ctx.outside, join(ctx.root, "link"));
    const r = await run(ctx, { op: "fs", kind: "stat", path: "link/机密.txt" });
    expect(r.ok).toBe(false);
  }, 30_000);

  test("直接指向外部文件的软链(不经目录)也被拒", async () => {
    const ctx = await setup();
    await symlink(join(ctx.outside, "机密.txt"), join(ctx.root, "直链.txt"));
    const r = await run(ctx, { op: "fs", kind: "read", path: "直链.txt" });
    expect(r.ok).toBe(false);
  }, 30_000);
});

describe("正常用法一点都不能被误伤", () => {
  test("root 内的读写照旧", async () => {
    const ctx = await setup();
    const w = await run(ctx, { op: "fs", kind: "write", path: "深/一层/中文文件.txt", content: "你好" });
    expect(w.ok).toBe(true);
    const r = await run(ctx, { op: "fs", kind: "read", path: "深/一层/中文文件.txt" });
    expect(r.ok).toBe(true);
    expect(r.data).toBe("你好");
  }, 30_000);

  test("list / stat / mkdir / delete 照旧", async () => {
    const ctx = await setup();
    expect((await run(ctx, { op: "fs", kind: "mkdir", path: "d1/d2" })).ok).toBe(true);
    await writeFile(join(ctx.root, "d1", "a.txt"), "1", "utf8");
    const l = await run(ctx, { op: "fs", kind: "list", path: "d1" });
    expect(l.ok).toBe(true);
    expect(String(l.data)).toContain("a.txt");
    expect((await run(ctx, { op: "fs", kind: "stat", path: "d1/a.txt" })).ok).toBe(true);
    expect((await run(ctx, { op: "fs", kind: "delete", path: "d1/a.txt" })).ok).toBe(true);
  }, 30_000);

  test("指向 root 内部的软链仍然可用(别把合法软链封死)", async () => {
    const ctx = await setup();
    await mkdir(join(ctx.root, "真实目录"), { recursive: true });
    await writeFile(join(ctx.root, "真实目录", "内部.txt"), "内部内容", "utf8");
    await symlink(join(ctx.root, "真实目录"), join(ctx.root, "内链"));
    const r = await run(ctx, { op: "fs", kind: "read", path: "内链/内部.txt" });
    expect(r.ok).toBe(true);
    expect(r.data).toBe("内部内容");
  }, 30_000);

  test("写一个还不存在的新文件照旧成功", async () => {
    const ctx = await setup();
    const r = await run(ctx, { op: "fs", kind: "write", path: "全新文件.txt", content: "新" });
    expect(r.ok).toBe(true);
    expect(await readFile(join(ctx.root, "全新文件.txt"), "utf8")).toBe("新");
  }, 30_000);

  test("二进制读写不受影响", async () => {
    const ctx = await setup();
    const bytes = Buffer.from([0x00, 0xff, 0x89, 0x50, 0x4e, 0x47]);
    const w = await run(ctx, {
      op: "fs", kind: "write", path: "b.bin",
      content: bytes.toString("base64"), encoding: "base64",
    });
    expect(w.ok).toBe(true);
    expect((await readFile(join(ctx.root, "b.bin"))).equals(bytes)).toBe(true);
  }, 30_000);
});

describe("前缀陷阱", () => {
  test("名字以 root 为前缀的兄弟目录不得被当成 root 内部", async () => {
    const ctx = await setup();
    const sibling = `${ctx.root}-evil`;
    await mkdir(sibling, { recursive: true });
    await writeFile(join(sibling, "偷.txt"), "兄弟目录里的内容", "utf8");
    await symlink(sibling, join(ctx.root, "兄弟链"));
    const r = await run(ctx, { op: "fs", kind: "read", path: "兄弟链/偷.txt" });
    expect(r.ok, "以 root 名为前缀的兄弟目录必须被判为外部").toBe(false);
  }, 30_000);
});

describe("exec 与既有防线不受影响", () => {
  test("exec 仍然可用", async () => {
    const ctx = await setup();
    const { result } = ctx.endpoint.execQueue.submit("c", "echo 软链修复没影响 exec");
    ctx.endpoint.dispatchExec(ctx.connId, ctx.endpoint.execQueue.take("c") as never, 20_000);
    const out = await result;
    expect(out.stdout).toContain("软链修复没影响 exec");
  }, 30_000);

  test("字符串层面的越权仍然被拒(.. 与绝对路径)", async () => {
    const ctx = await setup();
    for (const path of ["../逃.txt", "/etc/passwd", "a/../../b"]) {
      expect((await run(ctx, { op: "fs", kind: "read", path })).ok, path).toBe(false);
    }
  }, 30_000);

  test("读不存在的文件仍是 ok:false 而不是挂死", async () => {
    const ctx = await setup();
    const r = await run(ctx, { op: "fs", kind: "read", path: "没有这个.txt" });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(false);
  }, 30_000);
});