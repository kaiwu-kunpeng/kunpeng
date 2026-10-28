import { describe, it, expect } from "vitest";
import {
  createWorkerConnectionRegistry,
  type WorkerConnection,
} from "../../src/server/worker/worker-connections.js";

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

describe("worker connection registry", () => {
  it("登记后该机器在线,摘除后离线", () => {
    const r = createWorkerConnectionRegistry();
    expect(r.isMachineOnline("acc-A", "m-1")).toBe(false);
    r.register(conn());
    expect(r.isMachineOnline("acc-A", "m-1")).toBe(true);
    expect(r.unregister("c1")).toBe(true);
    expect(r.isMachineOnline("acc-A", "m-1")).toBe(false);
  });

  it("重连换 connId 但同 machineId 仍在线,且不产生重复记录", () => {
    const r = createWorkerConnectionRegistry();
    r.register(conn({ connId: "c1" }));
    r.register(conn({ connId: "c2" }));
    expect(r.isMachineOnline("acc-A", "m-1")).toBe(true);
    expect(r.size()).toBe(1);
    expect(r.listByAccount("acc-A").length).toBe(1);
    expect(r.findMachine("acc-A", "m-1")?.connId).toBe("c2");
  });

  it("跨账号隔离:别的账号查不到这台机器", () => {
    const r = createWorkerConnectionRegistry();
    r.register(conn({ accountId: "acc-A", machineId: "m-1" }));
    expect(r.isMachineOnline("acc-B", "m-1")).toBe(false);
    expect(r.findMachine("acc-B", "m-1")).toBeNull();
    expect(r.listByAccount("acc-B")).toEqual([]);
  });

  it("listByAccount 只返回本账号的连接", () => {
    const r = createWorkerConnectionRegistry();
    r.register(conn({ connId: "a1", accountId: "acc-A", machineId: "m-1" }));
    r.register(conn({ connId: "a2", accountId: "acc-A", machineId: "m-2" }));
    r.register(conn({ connId: "b1", accountId: "acc-B", machineId: "m-9" }));
    expect(r.size()).toBe(3);
    const listA = r.listByAccount("acc-A").map((c) => c.machineId).sort();
    expect(listA).toEqual(["m-1", "m-2"]);
    expect(r.listByAccount("acc-B").map((c) => c.machineId)).toEqual(["m-9"]);
  });

  it("findMachine 两个键都要匹配", () => {
    const r = createWorkerConnectionRegistry();
    r.register(conn({ accountId: "acc-A", machineId: "m-1" }));
    expect(r.findMachine("acc-A", "m-1")).not.toBeNull();
    expect(r.findMachine("acc-A", "m-x")).toBeNull();
    expect(r.findMachine("acc-X", "m-1")).toBeNull();
  });

  it("findMachine 返回登记时的机器名与根目录", () => {
    const r = createWorkerConnectionRegistry();
    r.register(conn({ machineName: "出差本", root: "/Users/x/proj" }));
    const found = r.findMachine("acc-A", "m-1");
    expect(found?.machineName).toBe("出差本");
    expect(found?.root).toBe("/Users/x/proj");
  });

  it("unregister 不存在的 connId 返回 false 且不影响其它连接", () => {
    const r = createWorkerConnectionRegistry();
    r.register(conn({ connId: "c1" }));
    expect(r.unregister("nope")).toBe(false);
    expect(r.size()).toBe(1);
    expect(r.isMachineOnline("acc-A", "m-1")).toBe(true);
  });

  it("两个 registry 实例互不影响(不得用模块级全局)", () => {
    const r1 = createWorkerConnectionRegistry();
    const r2 = createWorkerConnectionRegistry();
    r1.register(conn());
    expect(r1.size()).toBe(1);
    expect(r2.size()).toBe(0);
    expect(r2.isMachineOnline("acc-A", "m-1")).toBe(false);
  });

  it("空登记表的各查询都安全返回", () => {
    const r = createWorkerConnectionRegistry();
    expect(r.size()).toBe(0);
    expect(r.listByAccount("acc-A")).toEqual([]);
    expect(r.findMachine("acc-A", "m-1")).toBeNull();
    expect(r.isMachineOnline("acc-A", "m-1")).toBe(false);
  });
});