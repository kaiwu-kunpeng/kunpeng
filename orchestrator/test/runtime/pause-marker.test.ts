import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pauseMarkerPath,
  requestPause,
  isPauseRequested,
  clearPause,
} from "../../src/runtime/pause-marker.js";

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-pause-")); });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe("pause-marker", () => {
  it("路径在 <repoRoot>/.kunpeng/pause/<flowId>", () => {
    expect(pauseMarkerPath("/r", "f1")).toBe(join("/r", ".kunpeng", "pause", "f1"));
  });

  it("未请求时 isPauseRequested=false", async () => {
    expect(await isPauseRequested(repo, "f1")).toBe(false);
  });

  it("requestPause 后 true,clearPause 后 false", async () => {
    await requestPause(repo, "f1");
    expect(await isPauseRequested(repo, "f1")).toBe(true);
    await clearPause(repo, "f1");
    expect(await isPauseRequested(repo, "f1")).toBe(false);
  });

  it("clearPause 不存在的标记不抛", async () => {
    await expect(clearPause(repo, "nope")).resolves.toBeUndefined();
  });

  it("多 flowId 互不影响", async () => {
    await requestPause(repo, "a");
    expect(await isPauseRequested(repo, "a")).toBe(true);
    expect(await isPauseRequested(repo, "b")).toBe(false);
  });
});