import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFlowLog, teeConsoleToFile } from "../src/runtime/flow-log.js";

describe("resolveFlowLog", () => {
  afterEach(() => {
    delete process.env.KUNPENG_FLOW_LOG;
  });

  it("env 已设(cockpit 启动)→ 原样返回、minted=false", () => {
    process.env.KUNPENG_FLOW_LOG = "/tmp/from-cockpit.log";
    const r = resolveFlowLog("/whatever/repo", "run");
    expect(r.logPath).toBe("/tmp/from-cockpit.log");
    expect(r.minted).toBe(false);
  });

  it("env 空(CLI 直跑)→ 在 repo 的 .kunpeng/cockpit/logs/ 铸路径、建目录、minted=true", () => {
    delete process.env.KUNPENG_FLOW_LOG;
    const repo = mkdtempSync(join(tmpdir(), "kp-flowlog-"));
    const r = resolveFlowLog(repo, "run", () => 123456);
    expect(r.minted).toBe(true);
    expect(r.logPath.startsWith(join(repo, ".kunpeng", "cockpit", "logs"))).toBe(true);
    expect(r.logPath.endsWith(".log")).toBe(true);
    expect(existsSync(join(repo, ".kunpeng", "cockpit", "logs"))).toBe(true);
  });

  it("env 为纯空白 → 视为未设,自己铸", () => {
    process.env.KUNPENG_FLOW_LOG = "   ";
    const repo = mkdtempSync(join(tmpdir(), "kp-flowlog-"));
    const r = resolveFlowLog(repo, "loop");
    expect(r.minted).toBe(true);
  });
});

describe("teeConsoleToFile", () => {
  it("安装后 console.log/error/warn 同步追加进文件,还原后停止写入", () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-tee-"));
    const logPath = join(repo, "x.log");
    const restore = teeConsoleToFile(logPath);
    try {
      console.log("hello");
      console.error("oops");
      console.warn("careful");
    } finally {
      restore();
    }
    const content = readFileSync(logPath, "utf8");
    expect(content).toContain("hello");
    expect(content).toContain("oops");
    expect(content).toContain("careful");
    console.log("after-restore-should-not-be-logged");
    expect(readFileSync(logPath, "utf8")).not.toContain("after-restore-should-not-be-logged");
  });

  it("写文件失败(路径不可写)不抛、不挡 console", () => {
    const restore = teeConsoleToFile("/this/path/does/not/exist/x.log");
    try {
      expect(() => console.log("still works")).not.toThrow();
    } finally {
      restore();
    }
  });
});
