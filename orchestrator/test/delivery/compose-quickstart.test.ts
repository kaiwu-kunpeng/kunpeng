import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const root = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const compose = root("docker-compose.yml");
const install = root("docs/runbooks/install.md");

describe("Docker 快速上手可用性(P0 交付阻断修复)", () => {
  it("compose 不再默认关闭鉴权 —— 否则容器内走 docker 网关会被判 forbidden-remote 直接 403", () => {
    expect(compose).not.toContain("KUNPENG_ALLOW_INSECURE");
  });

  it("环境文件缺失不再让 compose 硬失败", () => {
    expect(compose).toMatch(/required:\s*false/);
  });

  it("宿主端口仍只发布到回环,安全边界没被放宽", () => {
    expect(compose).toContain('"127.0.0.1:7777:7777"');
  });

  it("容器内仍监听 0.0.0.0(否则端口转发进不来)", () => {
    expect(compose).toMatch(/--host/);
    expect(compose).toMatch(/0\.0\.0\.0/);
  });

  it("安装文档不再声称默认关闭鉴权", () => {
    expect(install).not.toContain("KUNPENG_ALLOW_INSECURE=1");
  });

  it("安装文档告诉客户首启随机密码去日志里取", () => {
    expect(install).toMatch(/首次启动/);
    expect(install).toMatch(/docker compose logs/);
    expect(install).toMatch(/admin/);
  });
});