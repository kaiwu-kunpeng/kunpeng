import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 2026-09-28 商业交付审计 R17：NOTICES 漏 cheerio / pdfjs-dist、没有隐私说明、安全邮箱是占位符。
const orch = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const read = (p: string) => readFileSync(p, "utf8");

const BEGIN = "<!-- npm-deps:begin -->";
const END = "<!-- npm-deps:end -->";
const GEN = orch("scripts/gen-third-party-notices.mjs");

type LockPkg = { version?: string; license?: string; dev?: boolean; devOptional?: boolean };
type Lock = { packages: Record<string, LockPkg> };

/** 独立于生成脚本的口径：lockfile 里非 dev 的已安装包，按 name@version 去重。 */
function prodPackages(lock: Lock): Map<string, { name: string; version: string; license: string }> {
  const out = new Map<string, { name: string; version: string; license: string }>();
  for (const [key, v] of Object.entries(lock.packages)) {
    if (!key.startsWith("node_modules/") || v.dev || v.devOptional) continue;
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    out.set(`${name}@${v.version}`, { name, version: String(v.version), license: String(v.license) });
  }
  return out;
}

function section(text: string): string {
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  expect(b, "缺少 npm-deps:begin 标记").toBeGreaterThanOrEqual(0);
  expect(e, "缺少 npm-deps:end 标记").toBeGreaterThan(b);
  return text.slice(b + BEGIN.length, e);
}

function dataRows(sec: string): string[] {
  return sec.split("\n").map((l) => l.trim())
    .filter((l) => l.startsWith("| ") && !l.startsWith("| 组件") && !/^\|\s*-/.test(l));
}

const MINI_NOTICES = [
  "# 头部说明保留",
  "",
  BEGIN,
  "| 组件 | 版本 | 许可证 |",
  "|---|---|---|",
  "| stale-pkg | 0.0.1 | MIT |",
  END,
  "",
  "## 尾部说明保留",
  "",
].join("\n");

describe("THIRD-PARTY-NOTICES 的 npm 依赖表由 lockfile 生成且与之一致", () => {
  const load = () => {
    const expected = prodPackages(JSON.parse(read(orch("package-lock.json"))) as Lock);
    return { expected, rows: dataRows(section(read(orch("THIRD-PARTY-NOTICES.md")))) };
  };

  it("每个生产依赖（含传递依赖）都有一行「| 名称 | 版本 | 许可证 |」", () => {
    const { expected, rows } = load();
    expect(expected.size).toBeGreaterThan(40);
    for (const p of expected.values()) {
      expect(rows, `NOTICES 缺 ${p.name}@${p.version}`).toContain(`| ${p.name} | ${p.version} | ${p.license} |`);
    }
  });

  it("没有多余或过期的行", () => {
    const { expected, rows } = load();
    expect(rows.length).toBe(expected.size);
  });

  it("审计点名的 cheerio 与 pdfjs-dist 已列入", () => {
    const { rows } = load();
    expect(rows.some((r) => r.startsWith("| cheerio | "))).toBe(true);
    expect(rows.some((r) => r.startsWith("| pdfjs-dist | ") && r.endsWith("| Apache-2.0 |"))).toBe(true);
  });

  it("Apache-2.0 声明段覆盖 npm 包形式的 pdfjs-dist", () => {
    const text = read(orch("THIRD-PARTY-NOTICES.md"));
    const apache = text.slice(text.indexOf("Apache License 2.0 声明"));
    expect(apache).toContain("pdfjs-dist");
  });

  it("NOTICES 写明了重新生成的命令", () => {
    expect(read(orch("THIRD-PARTY-NOTICES.md"))).toContain("node scripts/gen-third-party-notices.mjs");
  });
});

describe("gen-third-party-notices.mjs 行为", () => {
  it("只重写标记之间的内容：加进新依赖、清掉过期行、保留标记外文本", () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-notices-"));
    const lockPath = join(dir, "package-lock.json");
    const noticesPath = join(dir, "NOTICES.md");
    writeFileSync(lockPath, JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "demo", version: "1.0.0" },
        "node_modules/zeta-dep": { version: "2.0.0", license: "ISC" },
        "node_modules/@scope/alpha": { version: "1.2.3", license: "MIT" },
        "node_modules/zeta-dep/node_modules/inner": { version: "0.1.0", license: "BSD-2-Clause" },
        "node_modules/devonly": { version: "5.0.0", license: "MIT", dev: true },
        "node_modules/devopt": { version: "6.0.0", license: "MIT", devOptional: true },
      },
    }));
    writeFileSync(noticesPath, MINI_NOTICES);
    execFileSync(process.execPath, [GEN, "--lock", lockPath, "--notices", noticesPath], { stdio: "pipe" });
    const out = read(noticesPath);
    const rows = dataRows(section(out));
    expect(rows).toEqual([
      "| @scope/alpha | 1.2.3 | MIT |",
      "| inner | 0.1.0 | BSD-2-Clause |",
      "| zeta-dep | 2.0.0 | ISC |",
    ]);
    expect(out.startsWith("# 头部说明保留\n")).toBe(true);
    expect(out).toContain("## 尾部说明保留");
    expect(out).not.toContain("stale-pkg");
  });

  it("有生产依赖缺 license 字段时失败退出，且不改写文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-notices-"));
    const lockPath = join(dir, "package-lock.json");
    const noticesPath = join(dir, "NOTICES.md");
    writeFileSync(lockPath, JSON.stringify({
      lockfileVersion: 3,
      packages: { "": {}, "node_modules/nolicense": { version: "1.0.0" } },
    }));
    writeFileSync(noticesPath, MINI_NOTICES);
    const r = spawnSync(process.execPath, [GEN, "--lock", lockPath, "--notices", noticesPath], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("nolicense");
    expect(read(noticesPath)).toBe(MINI_NOTICES);
  });
});

describe("隐私说明 PRIVACY.md", () => {
  const privacy = () => (existsSync(root("PRIVACY.md")) ? read(root("PRIVACY.md")) : "");

  it("标注待法务审阅，并列出核实过的本机数据位置", () => {
    const text = privacy();
    for (const s of ["待法务审阅", "KUNPENG_STATE", "auth.json", "accounts.json", "chat/", "uploads/",
      "captures/", ".kunpeng/artifacts", "ops-events.jsonl", "~/.claude/projects", "~/.codex/sessions"]) {
      expect(text, `PRIVACY.md 缺 ${s}`).toContain(s);
    }
  });

  it("列出源码里真实存在的外部服务调用", () => {
    const text = privacy();
    for (const s of ["Anthropic", "OpenAI", "xcrawl", "Telegram", "WxPusher", "Server酱", "企业微信",
      "IndexNow", "Brandfetch", "NEON_DATABASE_URL"]) {
      expect(text, `PRIVACY.md 缺 ${s}`).toContain(s);
    }
  });

  it("如实写明留存：只有 kunpeng gc 清 7 天前的子进程日志", () => {
    const text = privacy();
    expect(text).toContain("kunpeng gc");
    expect(text).toContain("7 天");
  });

  it("README 的许可与支持段落链接到 PRIVACY.md", () => {
    const readme = read(root("README.md"));
    const seg = readme.slice(readme.indexOf("## 许可与支持"));
    expect(seg).toContain("(PRIVACY.md)");
  });
});

const SCRIPT = root("scripts/make-delivery.sh");
describe.skipIf(!existsSync(SCRIPT))("出包闸：安全邮箱仍是占位符时拒绝出包", () => {
  it("make-delivery.sh 检查包内 SECURITY.md 的「待填域名」占位并 exit 1", () => {
    const s = read(SCRIPT);
    const line = s.split("\n").find((l) => l.includes("待填域名"));
    expect(line, "make-delivery.sh 没有检查 SECURITY.md 占位").toBeDefined();
    expect(line).toContain("SECURITY.md");
    expect(line).toMatch(/exit 1|extra_fail=1/);
    const gate = s.indexOf("待填域名");
    const tar = s.indexOf('tar -czf "$package_path"');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(tar);
  });

});