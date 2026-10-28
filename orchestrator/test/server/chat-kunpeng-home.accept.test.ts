import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { streamChat } from "../../src/server/chat-stream.js";
import { ConversationStore } from "../../src/chat/conversation-store.js";
import { stageMethodologyRoot } from "../../src/agent/stage-methodology.js";

const ORCH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = resolve(ORCH, "..");

describe("对话不传 kunpengHome 时从 KUNPENG_HOME 选号（作者锁定）", () => {
  let dir = "";
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kp-chat-home-"));
    const binDir = join(dir, "bin");
    const cred = join(dir, "cred");
    await mkdir(binDir, { recursive: true });
    await mkdir(cred, { recursive: true });
    await writeFile(join(cred, "auth.json"), "{}", "utf8");
    await mkdir(join(dir, "kphome", ".kunpeng"), { recursive: true });
    await writeFile(join(dir, "kphome", ".kunpeng", "accounts.json"),
      JSON.stringify([{ id: "demo-acct", name: "demo-acct", backend: "claude", env: { CLAUDE_CONFIG_DIR: cred } }]), "utf8");
    await mkdir(join(dir, "fakehome"), { recursive: true });
    const script = [
      "#!/bin/sh",
      "cat >/dev/null",
      "printf '%s' \"$CLAUDE_CONFIG_DIR\" > '" + join(dir, "seen-config-dir") + "'",
      "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"fake-sess-home\"}'",
      "printf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"ok\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}'",
      "exit 0",
      "",
    ].join("\n");
    await writeFile(join(binDir, "claude"), script, "utf8");
    await chmod(join(binDir, "claude"), 0o755);
    for (const key of ["KUNPENG_CHAT_BIN_DIR", "KUNPENG_STATE", "KUNPENG_BACKEND", "KUNPENG_HOME", "KUNPENG_ACCOUNTS", "HOME", "CLAUDE_CONFIG_DIR"]) saved[key] = process.env[key];
    process.env.KUNPENG_CHAT_BIN_DIR = binDir;
    process.env.KUNPENG_STATE = join(dir, "state");
    process.env.KUNPENG_HOME = join(dir, "kphome");
    process.env.HOME = join(dir, "fakehome");
    delete process.env.KUNPENG_BACKEND;
    delete process.env.KUNPENG_ACCOUNTS;
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  test("streamChat 不传 kunpengHome：选中 KUNPENG_HOME 下的账号，env 注入子进程，用量记进该 HOME 的 quota.json", async () => {
    const store = new ConversationStore(join(dir, "chat"), { now: Date.now, id: () => "conv-home-accept" });
    const server = createServer((_req, res) => {
      void streamChat("kunpeng", "你好", "claude-fable-5-1", [], false, dir, res, {
        store, username: "accept", projectId: "kunpeng",
      }).catch(error => res.destroy(error instanceof Error ? error : new Error(String(error))));
    });
    try {
      await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");
      const response = await fetch("http://127.0.0.1:" + address.port, { signal: AbortSignal.timeout(20000) });
      await response.text();
      expect(await readFile(join(dir, "seen-config-dir"), "utf8")).toBe(join(dir, "cred"));
      const quotaPath = join(dir, "kphome", ".kunpeng", "quota.json");
      expect(existsSync(quotaPath)).toBe(true);
      expect(await readFile(quotaPath, "utf8")).toContain("demo-acct");
      expect(existsSync(join(dir, "fakehome", ".kunpeng", "quota.json"))).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r, reject) => server.close(error => error ? reject(error) : r()));
    }
  });
});

describe("鲲鹏 HOME 只有一个解析来源（作者锁定）", () => {
  test("stageMethodologyRoot：KUNPENG_HOME 非空取它；为空串时回推到仓根而不是空串", () => {
    expect(stageMethodologyRoot({ KUNPENG_HOME: "/tmp/demo-kp-home" })).toBe("/tmp/demo-kp-home");
    expect(resolve(stageMethodologyRoot({ KUNPENG_HOME: "" }))).toBe(REPO);
    expect(resolve(stageMethodologyRoot({}))).toBe(REPO);
  });

  test("源码里除 util/kunpeng-home.ts 外，无人直接读 KUNPENG_HOME 环境变量，也无人把 kunpengHome 默认成 homedir()", async () => {
    const srcRoot = join(ORCH, "src");
    const helper = join(srcRoot, "util", "kunpeng-home.ts");
    const files: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.name.endsWith(".ts")) files.push(p);
      }
    };
    await walk(srcRoot);
    const envRead = /\benv\s*(?:\.\s*KUNPENG_HOME\b|\[\s*["'`]KUNPENG_HOME["'`]\s*\])/;
    const homedirDefault = /kunpengHome\s*(?:\?\?|\|\|)\s*(?:os\.)?homedir\(\)/;
    const offenders = files
      .filter((f) => f !== helper)
      .filter((f) => { const s = readFileSync(f, "utf8"); return envRead.test(s) || homedirDefault.test(s); })
      .map((f) => relative(ORCH, f));
    expect(offenders).toEqual([]);
    expect(existsSync(helper)).toBe(true);
    expect(envRead.test(readFileSync(helper, "utf8"))).toBe(true);
  });
});