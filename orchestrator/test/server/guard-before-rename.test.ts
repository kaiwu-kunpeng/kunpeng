import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  awaitGateWatchIdle,
  ensureVapidKeys,
  startGateWatch,
} from "../../src/server/push.js";

const roots: string[] = [];
const stoppers: Array<() => Promise<void>> = [];

function tempState(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  for (const stop of stoppers.splice(0)) await stop().catch(() => undefined);
  await awaitGateWatchIdle().catch(() => undefined);
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpLeftovers(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith(".tmp"));
}

describe("停止后即使写已在飞,也不许把文件 rename 进目录", () => {
  it("停止 + 等静默后,seen-gates.json 与任何 .tmp 都不存在", async () => {
    const state = tempState("kp-gbr-stop-");
    await ensureVapidKeys(state);
    const stop = startGateWatch(60000);
    await stop();
    await awaitGateWatchIdle();

    const pushDir = join(state, "push");
    expect(existsSync(join(pushDir, "seen-gates.json"))).toBe(false);
    expect(tmpLeftovers(pushDir)).toEqual([]);
  });

  it("跨代(下一次 startGateWatch 已启动)也不许写回上一代的目录", async () => {
    const first = tempState("kp-gbr-genA-");
    await ensureVapidKeys(first);
    const stopFirst = startGateWatch(60000);
    await stopFirst();
    await awaitGateWatchIdle();
    const snapshotA = existsSync(join(first, "push"))
      ? readdirSync(join(first, "push")).sort()
      : [];

    const second = tempState("kp-gbr-genB-");
    await ensureVapidKeys(second);
    const stopSecond = startGateWatch(60000);
    stoppers.push(stopSecond);
    await awaitGateWatchIdle();

    const afterA = existsSync(join(first, "push"))
      ? readdirSync(join(first, "push")).sort()
      : [];
    expect(afterA).toEqual(snapshotA);
    expect(afterA).not.toContain("seen-gates.json");
  });

  it("没停止时功能仍在:seen-gates.json 正常写出,且不留 .tmp", async () => {
    const state = tempState("kp-gbr-alive-");
    await ensureVapidKeys(state);
    const stop = startGateWatch(60000);
    stoppers.push(stop);
    await awaitGateWatchIdle();

    const pushDir = join(state, "push");
    expect(existsSync(join(pushDir, "seen-gates.json"))).toBe(true);
    expect(tmpLeftovers(pushDir)).toEqual([]);
  });

  it("反复启停不残留 .tmp 垃圾", async () => {
    const state = tempState("kp-gbr-churn-");
    await ensureVapidKeys(state);
    for (let round = 0; round < 3; round += 1) {
      const stop = startGateWatch(60000);
      await stop();
      await awaitGateWatchIdle();
    }
    const pushDir = join(state, "push");
    if (existsSync(pushDir)) expect(tmpLeftovers(pushDir)).toEqual([]);
    mkdirSync(pushDir, { recursive: true });
    expect(tmpLeftovers(pushDir)).toEqual([]);
  });
});