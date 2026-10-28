import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveKunpengHome } from "../../src/util/kunpeng-home.js";
import { chatAccountEnv } from "../../src/server/chat-stream.js";

const ORCH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = resolve(ORCH, "..");

describe("resolveKunpengHome 单一来源（作者锁定）", () => {
  const saved: Record<string, string | undefined> = {};
  const temps: string[] = [];
  beforeEach(() => {
    for (const key of ["KUNPENG_HOME", "KUNPENG_ACCOUNTS"]) saved[key] = process.env[key];
    delete process.env.KUNPENG_ACCOUNTS;
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
  });

  test("KUNPENG_HOME 非空时原样返回", () => {
    process.env.KUNPENG_HOME = "/tmp/demo-kp-home";
    expect(resolveKunpengHome()).toBe("/tmp/demo-kp-home");
  });

  test("KUNPENG_HOME 未设或为空串时回推到仓根（src 布局）", () => {
    delete process.env.KUNPENG_HOME;
    expect(resolve(resolveKunpengHome())).toBe(REPO);
    process.env.KUNPENG_HOME = "";
    expect(resolve(resolveKunpengHome())).toBe(REPO);
  });

  test("dist 布局：模块放在 <root>/orchestrator/dist/util/ 下时回推到 <root>", async () => {
    delete process.env.KUNPENG_HOME;
    const root = realpathSync(mkdtempSync(join(tmpdir(), "kp-home-dist-")));
    temps.push(root);
    const distUtil = join(root, "orchestrator", "dist", "util");
    mkdirSync(distUtil, { recursive: true });
    copyFileSync(join(ORCH, "src", "util", "kunpeng-home.ts"), join(distUtil, "kunpeng-home.ts"));
    const mod = await import(pathToFileURL(join(distUtil, "kunpeng-home.ts")).href) as { resolveKunpengHome: () => string };
    expect(realpathSync(mod.resolveKunpengHome())).toBe(root);
  });

  test("chatAccountEnv(resolveKunpengHome()) 选中 KUNPENG_HOME 下 accounts.json 里的账号", async () => {
    const home = mkdtempSync(join(tmpdir(), "kp-home-acct-"));
    temps.push(home);
    const cred = join(home, "cred");
    mkdirSync(cred, { recursive: true });
    writeFileSync(join(cred, "auth.json"), "{}", "utf8");
    mkdirSync(join(home, ".kunpeng"), { recursive: true });
    writeFileSync(join(home, ".kunpeng", "accounts.json"),
      JSON.stringify([{ id: "demo-acct", name: "demo-acct", backend: "claude", env: { CLAUDE_CONFIG_DIR: cred } }]), "utf8");
    process.env.KUNPENG_HOME = home;
    const picked = await chatAccountEnv(resolveKunpengHome(), "claude");
    expect(picked.id).toBe("demo-acct");
    expect(picked.env?.CLAUDE_CONFIG_DIR).toBe(cred);
  });
});