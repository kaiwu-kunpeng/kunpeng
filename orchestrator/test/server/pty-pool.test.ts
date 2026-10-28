import { describe, expect, it } from "vitest";
import { PtySessionPool, type PtyHandle, type PtySpawnOpts } from "../../src/server/pty-pool.js";

class FakePty implements PtyHandle {
  written: string[] = [];
  resized: Array<[number, number]> = [];
  killed = false;
  dataCb?: (d: string) => void;
  exitCb?: (c: number) => void;
  constructor(public opts: PtySpawnOpts) {}
  write(d: string) { this.written.push(d); }
  resize(c: number, r: number) { this.resized.push([c, r]); }
  onData(cb: (d: string) => void) { this.dataCb = cb; }
  onExit(cb: (c: number) => void) { this.exitCb = cb; }
  kill() { this.killed = true; }
  emit(d: string) { this.dataCb?.(d); }
  exit(c: number) { this.exitCb?.(c); }
}

function mkPool(scrollbackLimit?: number) {
  const ptys: FakePty[] = [];
  const factory = (o: PtySpawnOpts) => { const p = new FakePty(o); ptys.push(p); return p; };
  let t = 1000;
  const pool = new PtySessionPool({ factory, scrollbackLimit, now: () => t++, defaultShell: "/bin/zsh" });
  return { pool, ptys };
}

describe("PtySessionPool", () => {
  it("create 返回 info,get/list 可查,list 按 workspace 过滤", () => {
    const { pool, ptys } = mkPool();
    const a = pool.create({ workspaceId: "ws1", cwd: "/tmp" });
    pool.create({ workspaceId: "ws2", cwd: "/tmp" });
    expect(a.alive).toBe(true);
    expect(a.shell).toBe("/bin/zsh");
    expect(a.cols).toBe(80);
    expect(pool.get(a.id)?.workspaceId).toBe("ws1");
    expect(pool.list().length).toBe(2);
    expect(pool.list("ws1").map((s) => s.id)).toEqual([a.id]);
    expect(ptys.length).toBe(2);
    expect(ptys[0].opts.cwd).toBe("/tmp");
  });

  it("onData 进环形缓冲,超 scrollbackLimit 截断保留最后部分", () => {
    const { pool, ptys } = mkPool(10);
    const s = pool.create({ workspaceId: "ws1", cwd: "/tmp" });
    ptys[0].emit("123456");
    ptys[0].emit("7890ABC");
    // 累计 "1234567890ABC"(13) 超 10 → 只留最后 10 "4567890ABC"
    expect(pool.scrollback(s.id)).toBe("4567890ABC");
  });

  it("subscribe 先回放滚屏再续推,退订后不再收", () => {
    const { pool, ptys } = mkPool();
    const s = pool.create({ workspaceId: "ws1", cwd: "/tmp" });
    ptys[0].emit("HELLO");
    const got: string[] = [];
    const unsub = pool.subscribe(s.id, (d) => got.push(d));
    expect(got).toEqual(["HELLO"]);   // 回放
    ptys[0].emit("WORLD");
    expect(got).toEqual(["HELLO", "WORLD"]); // 续推
    unsub();
    ptys[0].emit("AFTER");
    expect(got).toEqual(["HELLO", "WORLD"]); // 退订后不再收
  });

  it("write/resize 委托底层并更新 info", () => {
    const { pool, ptys } = mkPool();
    const s = pool.create({ workspaceId: "ws1", cwd: "/tmp" });
    pool.write(s.id, "ls\r");
    pool.resize(s.id, 120, 40);
    expect(ptys[0].written).toEqual(["ls\r"]);
    expect(ptys[0].resized).toEqual([[120, 40]]);
    expect(pool.get(s.id)?.cols).toBe(120);
    expect(pool.get(s.id)?.rows).toBe(40);
  });

  it("onExit 置 alive=false;kill 委托并标记;无此会话抛错", () => {
    const { pool, ptys } = mkPool();
    const s = pool.create({ workspaceId: "ws1", cwd: "/tmp" });
    ptys[0].exit(0);
    expect(pool.get(s.id)?.alive).toBe(false);
    pool.kill(s.id);
    expect(ptys[0].killed).toBe(true);
    expect(() => pool.write("nope", "x")).toThrow(/no pty session/);
  });
});
