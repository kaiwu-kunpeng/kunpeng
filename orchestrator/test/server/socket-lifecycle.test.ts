import { describe, it, expect } from "vitest";
import {
  attachWorkerSocket,
  type WorkerSocketLike,
} from "../../src/server/worker/socket-lifecycle.js";
import {
  createWorkerConnectionRegistry,
  type WorkerConnection,
} from "../../src/server/worker/worker-connections.js";

class FakeSocket implements WorkerSocketLike {
  private handlers: Record<string, Array<() => void>> = { close: [], error: [] };
  on(event: "close" | "error", listener: () => void): void {
    this.handlers[event].push(listener);
  }
  emit(event: "close" | "error"): void {
    for (const h of this.handlers[event]) h();
  }
}

function conn(over: Partial<WorkerConnection> = {}): WorkerConnection {
  return {
    connId: "c1",
    accountId: "acc-A",
    machineId: "m-1",
    machineName: "MacBook",
    root: "/Users/x/code",
    connectedAt: 1_700_000_000_000,
    ...over,
  };
}

describe("worker socket lifecycle", () => {
  it("attach 后该机器在线", () => {
    const r = createWorkerConnectionRegistry();
    attachWorkerSocket({ registry: r, socket: new FakeSocket(), connection: conn() });
    expect(r.isMachineOnline("acc-A", "m-1")).toBe(true);
    expect(r.size()).toBe(1);
  });

  it("socket close 后自动摘除,机器转离线", () => {
    const r = createWorkerConnectionRegistry();
    const s = new FakeSocket();
    attachWorkerSocket({ registry: r, socket: s, connection: conn() });
    s.emit("close");
    expect(r.isMachineOnline("acc-A", "m-1")).toBe(false);
    expect(r.size()).toBe(0);
  });

  it("socket error 后同样摘除", () => {
    const r = createWorkerConnectionRegistry();
    const s = new FakeSocket();
    attachWorkerSocket({ registry: r, socket: s, connection: conn() });
    s.emit("error");
    expect(r.isMachineOnline("acc-A", "m-1")).toBe(false);
  });

  it("detach 手动摘除有效", () => {
    const r = createWorkerConnectionRegistry();
    const a = attachWorkerSocket({ registry: r, socket: new FakeSocket(), connection: conn() });
    a.detach();
    expect(r.size()).toBe(0);
  });

  it("幂等:close + error + 多次 detach 混合触发只摘一次", () => {
    const r = createWorkerConnectionRegistry();
    const s = new FakeSocket();
    const a = attachWorkerSocket({ registry: r, socket: s, connection: conn() });
    s.emit("close");
    s.emit("error");
    a.detach();
    a.detach();
    expect(r.size()).toBe(0);
    expect(r.isMachineOnline("acc-A", "m-1")).toBe(false);
  });

  it("重连不误摘:旧 socket 迟到的 close 不得摘掉新连接", () => {
    const r = createWorkerConnectionRegistry();
    const oldSocket = new FakeSocket();
    attachWorkerSocket({ registry: r, socket: oldSocket, connection: conn({ connId: "old" }) });
    const newSocket = new FakeSocket();
    attachWorkerSocket({ registry: r, socket: newSocket, connection: conn({ connId: "new" }) });
    expect(r.size()).toBe(1);
    expect(r.findMachine("acc-A", "m-1")?.connId).toBe("new");

    oldSocket.emit("close");

    expect(r.isMachineOnline("acc-A", "m-1")).toBe(true);
    expect(r.findMachine("acc-A", "m-1")?.connId).toBe("new");
    expect(r.size()).toBe(1);
  });

  it("多条不同连接互不干扰", () => {
    const r = createWorkerConnectionRegistry();
    const s1 = new FakeSocket();
    const s2 = new FakeSocket();
    attachWorkerSocket({ registry: r, socket: s1, connection: conn({ connId: "c1", machineId: "m-1" }) });
    attachWorkerSocket({ registry: r, socket: s2, connection: conn({ connId: "c2", machineId: "m-2" }) });
    expect(r.size()).toBe(2);
    s1.emit("close");
    expect(r.isMachineOnline("acc-A", "m-1")).toBe(false);
    expect(r.isMachineOnline("acc-A", "m-2")).toBe(true);
    expect(r.size()).toBe(1);
  });

  it("跨账号:摘除只影响本账号本机器", () => {
    const r = createWorkerConnectionRegistry();
    const sA = new FakeSocket();
    attachWorkerSocket({ registry: r, socket: sA, connection: conn({ connId: "a", accountId: "acc-A" }) });
    attachWorkerSocket({ registry: r, socket: new FakeSocket(), connection: conn({ connId: "b", accountId: "acc-B" }) });
    sA.emit("close");
    expect(r.isMachineOnline("acc-A", "m-1")).toBe(false);
    expect(r.isMachineOnline("acc-B", "m-1")).toBe(true);
  });
});