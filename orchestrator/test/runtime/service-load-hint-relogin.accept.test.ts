// R05c：launchd 加载提示必须告诉用户注销再登录，否则手工 bootstrap 的服务会被静默回收。作者锁定。
import { describe, expect, it } from "vitest";
import { serviceLoadHint } from "../../src/runtime/service-templates.js";

const files = [
  { file: "com.kunpeng.serve.plist", content: "" },
  { file: "com.kunpeng.autopilot.plist", content: "" },
];

describe("launchd 加载提示补上注销再登录（作者锁定）", () => {
  const hint = serviceLoadHint("launchd", "/out", files as never);
  const lines = hint.split("\n");

  it("仍逐个给出 bootstrap 行", () => {
    for (const f of files) expect(hint).toContain(`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/${f.file}`);
  });

  it("提示注销并重新登录，并说明原因是 LWCR", () => {
    expect(hint).toContain("注销并重新登录");
    expect(hint).toContain("managed LWCR");
    expect(hint).toContain("launchctl print");
  });

  it("说明文字在所有 bootstrap 行之后，且每行都是 shell 注释", () => {
    const lastBootstrap = Math.max(...lines.map((l, i) => (l.includes("launchctl bootstrap") ? i : -1)));
    const noteIdx = lines.findIndex((l) => l.includes("注销并重新登录"));
    expect(noteIdx).toBeGreaterThan(lastBootstrap);
    for (const l of lines) {
      if (l.includes("LWCR") || l.includes("注销")) expect(l.startsWith("# ")).toBe(true);
    }
  });

  it("systemd 提示不受影响，不出现 LWCR 说明", () => {
    const sd = serviceLoadHint("systemd", "/out", [{ file: "kunpeng-serve.service", content: "" }] as never);
    expect(sd).not.toContain("LWCR");
    expect(sd).toContain("systemctl --user daemon-reload");
  });
});