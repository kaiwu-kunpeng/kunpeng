import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { holdFilePath } from "../../src/cli-commands/deploy.js";
import { kunpengStateDir } from "../../src/project/state-dir.js";
import { parseHold } from "../../src/runtime/deploy-gate.js";

let sandbox = "";

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "kp-hold-path-"));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("闸文件位置", () => {
  test("落在 kunpengStateDir 之下,文件名固定", () => {
    const env = { KUNPENG_STATE: sandbox } as NodeJS.ProcessEnv;
    expect(holdFilePath(env)).toBe(join(kunpengStateDir(env), "deploy-hold.json"));
    expect(holdFilePath(env).endsWith("deploy-hold.json")).toBe(true);
  });

  test("尊重 KUNPENG_STATE(沙箱隔离不能被绕过)", () => {
    const a = holdFilePath({ KUNPENG_STATE: sandbox } as NodeJS.ProcessEnv);
    const b = holdFilePath({ KUNPENG_STATE: join(sandbox, "另一个") } as NodeJS.ProcessEnv);
    expect(a).not.toBe(b);
    expect(a.startsWith(sandbox)).toBe(true);
  });

  test("没设 KUNPENG_STATE 时落在 ~/.kunpeng 下", () => {
    const p = holdFilePath({} as NodeJS.ProcessEnv);
    expect(p).toBe(join(homedir(), ".kunpeng", "deploy-hold.json"));
  });

  test("绝不落在主仓根目录", () => {
    const p = holdFilePath({} as NodeJS.ProcessEnv);
    expect(p).not.toBe(join(homedir(), "kunpeng", "deploy-hold.json"));
    expect(p).toContain(".kunpeng");
  });

  test("纯函数:同样 env 多次调用一致,且不受真实 process.env 影响", () => {
    const env = { KUNPENG_STATE: sandbox } as NodeJS.ProcessEnv;
    const first = holdFilePath(env);
    const saved = process.env.KUNPENG_STATE;
    process.env.KUNPENG_STATE = "/完全不同的地方";
    try {
      expect(holdFilePath(env)).toBe(first);
    } finally {
      if (saved === undefined) delete process.env.KUNPENG_STATE;
      else process.env.KUNPENG_STATE = saved;
    }
  });
});

describe("闸文件的读写语义", () => {
  test("写进去的内容能被 parseHold 判成拦住", async () => {
    const p = holdFilePath({ KUNPENG_STATE: sandbox } as NodeJS.ProcessEnv);
    await writeFile(p, JSON.stringify({ held: true, reason: "先审再上", at: 1 }), "utf8");
    const state = parseHold(await readFile(p, "utf8"));
    expect(state.held).toBe(true);
    expect(state.reason).toBe("先审再上");
  });

  test("文件不存在等同于不拦", () => {
    expect(parseHold(null).held).toBe(false);
  });

  test("文件损坏仍然拦住(fail-closed 未被破坏)", async () => {
    const p = holdFilePath({ KUNPENG_STATE: sandbox } as NodeJS.ProcessEnv);
    await writeFile(p, "{ 这不是 json", "utf8");
    expect(parseHold(await readFile(p, "utf8")).held).toBe(true);
  });

  test("目标目录是可写的真实目录", async () => {
    const dir = kunpengStateDir({ KUNPENG_STATE: sandbox } as NodeJS.ProcessEnv);
    expect((await stat(dir)).isDirectory()).toBe(true);
  });
});