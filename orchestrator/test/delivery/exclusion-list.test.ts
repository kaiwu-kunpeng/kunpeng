import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const rootUrl = (p: string) => new URL(`../../../${p}`, import.meta.url);
const SCRIPT_URL = rootUrl("scripts/make-delivery.sh");
const RELEASE_URL = rootUrl("docs/runbooks/release.md");
// 交付包不含 scripts/(出包脚本本身是交付方内部件),本守门只在开发仓里跑。
const IN_DEV_REPO = existsSync(SCRIPT_URL) && existsSync(RELEASE_URL);
const read = (u: URL): string => (existsSync(u) ? readFileSync(u, "utf8") : "");
const script = read(SCRIPT_URL);
const release = read(RELEASE_URL);

const NEW_EXCLUSIONS = [
  "docs/audits/",
  "docs/reports/",
  "docs/research/",
  "docs/handoffs/",
  "docs/ops/",
  "docs/proposals/",
  "docs/superpowers/",
  "docs/decisions/",
  "docs/runbooks/cockpit-remote-access.md",
  "docs/runbooks/aeohq-cloudflare-tunnel.md",
  "scripts/",
  ".tmp-shots/",
  "orchestrator/.kunpeng/",
  "orchestrator/AGENTS-ACTIVE.md",
  "orchestrator/docs/specs/",
  "PROJECT.md",
  "orchestrator/test/delivery/tarball-layout.test.ts",
  "orchestrator/src/git/git-wall.test.ts",
  "orchestrator/src/util/repo-root.test.ts",
  "orchestrator/test/repo/geo-seed-retired.test.ts",
  "orchestrator/test/sdk/lint-gate-wiring.test.ts",
];
const OLD_EXCLUSIONS = ["plans/", "roster/", ".kunpeng/", "docs/specs/", "orchestrator/specs/", "COORDINATION.md", "TECHDEBT.md", "AGENTS-ACTIVE.md"];

describe.skipIf(!IN_DEV_REPO)("出包排除清单(2026-09-14 补齐,作者锁定)", () => {
  it.each(NEW_EXCLUSIONS)("新增排除 %s", (p) => {
    expect(script).toContain(`"${p}"`);
  });

  it.each(OLD_EXCLUSIONS)("原有排除 %s 仍在", (p) => {
    expect(script).toContain(`"${p}"`);
  });

  it("orchestrator/scripts 不在排除清单里(构建脚本 with-build-lock 必须随包)", () => {
    expect(script).not.toContain('"orchestrator/scripts/"');
  });

  it("中性化在额外硬闸之前、额外硬闸在租户闸之前", () => {
    const neut = script.indexOf("中性化");
    const gate = script.indexOf("额外硬闸");
    const tenant = script.indexOf(': >"$matches_file"');
    expect(neut).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(neut);
    expect(tenant).toBeGreaterThan(gate);
  });

  it("额外硬闸覆盖个人标识/手机号/凭据形状/凭据文件,命中即非零退出", () => {
    for (const s of ["个人标识闸失败", "手机号闸失败", "凭据形状闸失败", "凭据文件闸失败"]) expect(script).toContain(s);
    expect(script).toMatch(/extra_fail" -eq 0 \]\] \|\| exit 1/);
  });

  it("发布手册记录了新增排除与中性化,原有禁令原句保留", () => {
    expect(release).toContain("禁止手工 tar 打包绕过该脚本");
    expect(release).toContain("租户闸豁免 `orchestrator/test/detenant/`");
    expect(release).toContain("中性化");
    expect(release).toContain(".tmp-shots/");
  });
});
