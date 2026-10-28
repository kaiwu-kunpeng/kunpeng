import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { awaitGateWatchIdle, ensureVapidKeys, startGateWatch } from "../../src/server/push.js";

const dirs: string[] = [];
const stoppers: Array<() => Promise<void>> = [];

function tempState(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const stop of stoppers.splice(0)) await stop().catch(() => undefined);
  await awaitGateWatchIdle().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("人工门轮询的停止函数", () => {
  it("功能仍在:没停止时首扫会写出 seen-gates.json", async () => {
    const state = tempState("kp-gw-alive-");
    await ensureVapidKeys(state);
    const stop = startGateWatch(60000);
    stoppers.push(stop);
    await awaitGateWatchIdle();
    expect(existsSync(join(state, "push", "seen-gates.json"))).toBe(true);
  });

  it("停止后不再写:目录能被干净删掉,且不会重新冒出文件", async () => {
    const state = tempState("kp-gw-stop-");
    await ensureVapidKeys(state);
    const stop = startGateWatch(60000);
    await stop();
    await awaitGateWatchIdle();

    // 这一步在修复前会抛 ENOTEMPTY / 或删完又被写回来
    rmSync(state, { recursive: true, force: true });
    expect(existsSync(state)).toBe(false);

    await awaitGateWatchIdle();
    expect(existsSync(join(state, "push", "seen-gates.json"))).toBe(false);
    expect(existsSync(state)).toBe(false);
  });

  it("停止函数可重复调用且不抛错", async () => {
    const state = tempState("kp-gw-twice-");
    await ensureVapidKeys(state);
    const stop = startGateWatch(60000);
    await expect(stop()).resolves.toBeUndefined();
    await expect(stop()).resolves.toBeUndefined();
  });

  it("停止后重新启动能正常工作(停止标志必须被清)", async () => {
    const first = tempState("kp-gw-restart-a-");
    await ensureVapidKeys(first);
    const stopFirst = startGateWatch(60000);
    await stopFirst();

    const second = tempState("kp-gw-restart-b-");
    await ensureVapidKeys(second);
    const stopSecond = startGateWatch(60000);
    stoppers.push(stopSecond);
    await awaitGateWatchIdle();
    expect(existsSync(join(second, "push", "seen-gates.json"))).toBe(true);
  });

  it("间隔小于 1000ms 仍然抛错", () => {
    expect(() => startGateWatch(999)).toThrow();
  });
});