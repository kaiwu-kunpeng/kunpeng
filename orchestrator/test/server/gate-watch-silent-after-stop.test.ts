import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  awaitGateWatchIdle,
  ensureVapidKeys,
  shouldReportGateScanError,
  startGateWatch,
} from "../../src/server/push.js";

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
  vi.restoreAllMocks();
});

describe("shouldReportGateScanError", () => {
  it("已停止不报,未停止照报", () => {
    expect(shouldReportGateScanError(true)).toBe(false);
    expect(shouldReportGateScanError(false)).toBe(true);
  });
});

describe("停止后收尾期不许打日志(这正是判失败的根因)", () => {
  it("停止 + 删目录的整个过程一次 console.error 都没有", async () => {
    const state = tempState("kp-gw-silent-");
    await ensureVapidKeys(state);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stop = startGateWatch(60000);
    await stop();
    rmSync(state, { recursive: true, force: true });
    await awaitGateWatchIdle();
    expect(spy).not.toHaveBeenCalled();
  });

  it("未停止时的真故障仍然要打出来(没把真问题一起吞掉)", async () => {
    // 注意:单纯删掉状态目录造不出故障 —— writeJson 内部会 mkdir 把目录重建出来。
    // 所以这里把状态目录本身换成一个「文件」,让 mkdir 必定 ENOTDIR,故障是确定性的。
    const state = tempState("kp-gw-loud-");
    await ensureVapidKeys(state);
    rmSync(state, { recursive: true, force: true });
    writeFileSync(state, "not-a-directory", "utf8");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stop = startGateWatch(60000);
    stoppers.push(stop);
    await awaitGateWatchIdle();
    expect(spy).toHaveBeenCalled();
  });
});