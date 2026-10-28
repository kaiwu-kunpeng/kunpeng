import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const root = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const compose = root("docker-compose.yml");
const example = root(".env.example");
const install = root("docs/runbooks/install.md");

describe("容器身份可配(修 EACCES 导致的 500)", () => {
  it("compose 暴露 user 覆盖且默认落在镜像内置 node 用户", () => {
    expect(compose).toMatch(/user:\s*"\$\{KUNPENG_UID:-1000\}:\$\{KUNPENG_GID:-1000\}"/);
  });

  it("上一波的安全默认没有被回退", () => {
    expect(compose).not.toContain("KUNPENG_ALLOW_INSECURE");
    expect(compose).toContain('"127.0.0.1:7777:7777"');
  });

  it("环境范例文件提供了这两个变量", () => {
    expect(example).toMatch(/KUNPENG_UID/);
    expect(example).toMatch(/KUNPENG_GID/);
  });

  it("文档给出 Linux 与 macOS 两种取值", () => {
    expect(install).toMatch(/KUNPENG_UID/);
    expect(install).toMatch(/macOS|Docker Desktop/);
    expect(install).toMatch(/chown/);
  });

  it("文档写明 500 与 EACCES 的排查方法", () => {
    expect(install).toMatch(/500/);
    expect(install).toMatch(/EACCES/);
  });
});