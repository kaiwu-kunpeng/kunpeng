import { describe, expect, test, afterEach } from "vitest";
import { createShellSession, type ShellSession } from "../../src/server/worker/shell-session.js";

const sessions: ShellSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) {
    try { s.close(); } catch { /* 清理尽力而为 */ }
  }
});

function newSession(opts: { cwd?: string } = {}): ShellSession {
  const s = createShellSession(opts);
  sessions.push(s);
  return s;
}

describe("常驻 shell · 既有行为(不传 onOutput 时必须逐条照旧)", () => {
  test("跑得出 stdout 与退出码 0", async () => {
    const s = newSession();
    const r = await s.run("echo hello");
    expect(r.stdout.trim()).toBe("hello");
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.truncated).toBe(false);
  });

  test("stderr 与非零退出码分别透传(子 shell:裸 exit 会杀掉常驻会话)", async () => {
    const s = newSession();
    const r = await s.run("echo oops 1>&2; (exit 3)");
    expect(r.stderr.trim()).toBe("oops");
    expect(r.exitCode).toBe(3);
    expect(s.isAlive()).toBe(true);
    expect((await s.run("echo 还活着")).stdout.trim()).toBe("还活着");
  });

  test("cd 在多条命令之间保持(这是常驻 shell 的意义)", async () => {
    const s = newSession();
    await s.run("cd /");
    const r = await s.run("pwd");
    expect(r.stdout.trim()).toBe("/");
  });

  test("哨兵绝不出现在结果里", async () => {
    const s = newSession();
    const r = await s.run("echo done");
    expect(r.stdout).not.toContain("\u001e");
    expect(r.stdout).not.toContain("\u001f");
    expect(r.stderr).not.toContain("\u001e");
    expect(r.stderr).not.toContain("\u001f");
    expect(r.stdout).not.toContain("KUNPENG_");
  });

  test("超时:timedOut 为真且 exitCode 为 null", async () => {
    const s = newSession();
    const r = await s.run("sleep 30", { timeoutMs: 400 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
  }, 15_000);

  test("超出上限时 truncated 为真且内容不超上限", async () => {
    const s = newSession();
    const r = await s.run("for i in $(seq 1 500); do echo 0123456789; done", { maxOutputBytes: 200 });
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.stdout)).toBeLessThanOrEqual(200);
  });

  test("isAlive / close", async () => {
    const s = newSession();
    expect(s.isAlive()).toBe(true);
    s.close();
    expect(s.isAlive()).toBe(false);
  });

  test("中文输出不乱码", async () => {
    const s = newSession();
    const r = await s.run("echo 你好世界");
    expect(r.stdout.trim()).toBe("你好世界");
  });
});

describe("常驻 shell · 流式回调", () => {
  test("回调拼接结果与 ExecResult.stdout 完全一致", async () => {
    const s = newSession();
    const seen: string[] = [];
    const r = await s.run("echo one; echo two; echo three", {
      onOutput: (stream, data) => { if (stream === "stdout") seen.push(data); },
    });
    expect(seen.join("")).toBe(r.stdout);
  });

  test("stderr 也走回调,且与 ExecResult.stderr 一致", async () => {
    const s = newSession();
    const out: string[] = [];
    const err: string[] = [];
    const r = await s.run("echo a; echo b 1>&2", {
      onOutput: (stream, data) => { (stream === "stderr" ? err : out).push(data); },
    });
    expect(err.join("")).toBe(r.stderr);
    expect(out.join("")).toBe(r.stdout);
  });

  test("确实是流式:命令结束前就已经收到过输出", async () => {
    const s = newSession();
    let sawFirst = false;
    const promise = s.run("echo 第一段; sleep 1.2; echo 第二段", {
      onOutput: (stream, data) => {
        if (stream === "stdout" && data.includes("第一段")) sawFirst = true;
      },
    });
    await new Promise((r) => setTimeout(r, 600));
    const earlyArrived = sawFirst;
    const r = await promise;
    expect(r.stdout).toContain("第二段");
    expect(earlyArrived).toBe(true);
  }, 15_000);

  test("回调内容里绝不含哨兵控制字符", async () => {
    const s = newSession();
    const seen: string[] = [];
    await s.run("echo alpha; echo beta 1>&2", {
      onOutput: (_stream, data) => { seen.push(data); },
    });
    const all = seen.join("");
    expect(all).not.toContain("\u001e");
    expect(all).not.toContain("\u001f");
    expect(all).not.toContain("KUNPENG_");
  });

  test("截断场景:回调总量不超上限,且与结果一致", async () => {
    const s = newSession();
    const seen: string[] = [];
    const r = await s.run("for i in $(seq 1 500); do echo 0123456789; done", {
      maxOutputBytes: 200,
      onOutput: (stream, data) => { if (stream === "stdout") seen.push(data); },
    });
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(seen.join(""))).toBeLessThanOrEqual(200);
    expect(seen.join("")).toBe(r.stdout);
  });

  test("中文在 chunk 边界被拆开也不吐乱码", async () => {
    const s = newSession();
    const seen: string[] = [];
    const r = await s.run("for i in $(seq 1 200); do echo 你好世界测试中文输出; done", {
      onOutput: (stream, data) => { if (stream === "stdout") seen.push(data); },
    });
    expect(seen.join("")).toBe(r.stdout);
    expect(seen.join("")).not.toContain("�");
  });

  test("回调抛异常不影响命令结果", async () => {
    const s = newSession();
    const r = await s.run("echo still-works", {
      onOutput: () => { throw new Error("回调炸了"); },
    });
    expect(r.stdout.trim()).toBe("still-works");
    expect(r.exitCode).toBe(0);
  });

  test("回调不影响 cd 保持", async () => {
    const s = newSession();
    await s.run("cd /", { onOutput: () => {} });
    const r = await s.run("pwd", { onOutput: () => {} });
    expect(r.stdout.trim()).toBe("/");
  });

  test("同一会话连跑两条命令,回调不串流", async () => {
    const s = newSession();
    const first: string[] = [];
    const r1 = await s.run("echo 甲", { onOutput: (_s, d) => first.push(d) });
    const second: string[] = [];
    const r2 = await s.run("echo 乙", { onOutput: (_s, d) => second.push(d) });
    expect(first.join("")).toBe(r1.stdout);
    expect(second.join("")).toBe(r2.stdout);
    expect(second.join("")).not.toContain("甲");
  });
});