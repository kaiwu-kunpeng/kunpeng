import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SwitchboardStore } from "../../src/switchboard/store.js";
import { runSignalCommand } from "../../src/runtime/signal-cli.js";

describe("bodyFrom 跳过带值 flag", () => {
  let dir: string;
  let seq = 0;
  const deps = { now: () => 1000 + seq, id: () => `m${seq++}` };
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "sigbody-")); seq = 0; });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("--from 的值不混进 body", async () => {
    const store = new SwitchboardStore(dir);
    const r = await runSignalCommand(["--to", "B", "--from", "A", "歇会"], store, "A", deps);
    expect(r.ok).toBe(true);
    const pending = await store.pendingStops("B");
    expect(pending[0].body).toBe("歇会");
  });

  it("--as 的值不混进 body", async () => {
    const store = new SwitchboardStore(dir);
    const r = await runSignalCommand(["--to", "B", "--as", "watcher", "停"], store, "X", deps);
    expect(r.ok).toBe(true);
    const pending = await store.pendingStops("B");
    expect(pending[0].body).toBe("停");
  });

  it("flag 顺序不同也只取真留言", async () => {
    const store = new SwitchboardStore(dir);
    const r = await runSignalCommand(["收工", "--from", "A", "--to", "B"], store, "A", deps);
    expect(r.ok).toBe(true);
    const pending = await store.pendingStops("B");
    expect(pending[0].body).toBe("收工");
  });

  it("无留言时仍兜底为 停止请求", async () => {
    const store = new SwitchboardStore(dir);
    const r = await runSignalCommand(["--to", "B", "--from", "A"], store, "A", deps);
    expect(r.ok).toBe(true);
    const pending = await store.pendingStops("B");
    expect(pending[0].body).toBe("停止请求");
  });
});