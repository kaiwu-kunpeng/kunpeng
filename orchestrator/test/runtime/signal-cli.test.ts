import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SwitchboardStore, kindOf } from "../../src/switchboard/store.js";
import { runSignalCommand } from "../../src/runtime/signal-cli.js";

describe("runSignalCommand", () => {
  let dir: string;
  let seq = 0;
  const deps = { now: () => 1000 + seq, id: () => `m${seq++}` };
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "sigcli-")); seq = 0; });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("--to 合法时发出 stop，并能在 pendingStops 查到", async () => {
    const store = new SwitchboardStore(dir);
    const r = await runSignalCommand(["--to", "B", "歇会"], store, "A", deps);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.to).toBe("B");
    const pending = await store.pendingStops("B");
    expect(pending.map((m) => m.id)).toEqual([r.id]);
    expect(kindOf(pending[0])).toBe("stop");
    expect(pending[0].body).toBe("歇会");
  });

  it("缺 --to 返回错误且不发消息", async () => {
    const store = new SwitchboardStore(dir);
    const r = await runSignalCommand(["停"], store, "A", deps);
    expect(r.ok).toBe(false);
    expect(await store.pendingStops("B")).toEqual([]);
  });

  it("--to 后跟另一个 flag（误当收件人）返回错误", async () => {
    const store = new SwitchboardStore(dir);
    const r = await runSignalCommand(["--to", "--from"], store, "A", deps);
    expect(r.ok).toBe(false);
  });

  it("无留言时 body 兜底为 停止请求", async () => {
    const store = new SwitchboardStore(dir);
    const r = await runSignalCommand(["--to", "B"], store, "A", deps);
    expect(r.ok).toBe(true);
    const pending = await store.pendingStops("B");
    expect(pending[0].body).toBe("停止请求");
  });
});