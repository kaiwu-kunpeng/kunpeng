import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const install = readFileSync(new URL("../../../docs/runbooks/install.md", import.meta.url), "utf8");

describe("安装手册:Docker Desktop 挂载路径须在共享目录(作者锁定)", () => {
  it("原有 macOS 属主说明原句保留", () => {
    expect(install).toContain(
      "- macOS Docker Desktop：绑定挂载在容器内一律呈现为 root 属主，非 root uid 无法写入；在 `.env` 中设置 `KUNPENG_UID=0`、`KUNPENG_GID=0`。",
    );
    expect(install).toMatch(/chown/);
    expect(install).toMatch(/EACCES/);
  });

  it("新增共享路径提醒与症状,且紧跟在属主说明之后", () => {
    expect(install).toContain("Docker Desktop 已共享");
    expect(install).toContain("not a git repository");
    const lines = install.split("\n");
    const ownerIdx = lines.findIndex((l) => l.startsWith("- macOS Docker Desktop：绑定挂载"));
    const shareIdx = lines.findIndex((l) => l.includes("Docker Desktop 已共享"));
    expect(ownerIdx).toBeGreaterThan(-1);
    expect(shareIdx).toBe(ownerIdx + 1);
    expect(lines[shareIdx]).toMatch(/^- macOS Docker Desktop：/);
    expect(lines[shareIdx]).toContain("KUNPENG_STATE");
    expect(lines[shareIdx]).toContain("KUNPENG_REPO");
  });
});
