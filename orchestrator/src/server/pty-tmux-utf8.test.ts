import { describe, it, expect } from "vitest";
import { tmuxNewSessionArgs } from "./pty-tmux.js";

// 回归:serve 由 launchd 拉起、环境无 LANG/LC_* 时,tmux 客户端会进非 UTF-8 模式
// (list-clients 的 client_utf8=0),把框线/中文全画成乱码(「全是 ----、——————」)。
// new-session 必须带全局 -u 强制 UTF-8 输出,否则终端整屏花屏。经实测:
//   env -i ... tmux    new-session -A -D ...  → client_utf8=0(花屏)
//   env -i ... tmux -u new-session -A -D ...  → client_utf8=1(正常)
describe("tmux 客户端强制 UTF-8(防非 UTF-8 locale 花屏)", () => {
  it("tmuxNewSessionArgs 以全局 -u 打头(必须在子命令 new-session 之前)", () => {
    const args = tmuxNewSessionArgs({ sessionName: "kp-x", cwd: "/tmp" });
    expect(args[0]).toBe("-u");
    // -u 是全局标志,必须在 new-session 之前,否则被 tmux 当作 new-session 的参数报错。
    expect(args.indexOf("-u")).toBeLessThan(args.indexOf("new-session"));
  });

  it("保留原有 new-session -A -D -s <name> -c <cwd> 语义", () => {
    const args = tmuxNewSessionArgs({ sessionName: "kp-abc", cwd: "/work/dir" });
    expect(args).toContain("new-session");
    expect(args).toContain("-A");
    expect(args).toContain("-D");
    const si = args.indexOf("-s");
    expect(args[si + 1]).toBe("kp-abc");
    const ci = args.indexOf("-c");
    expect(args[ci + 1]).toBe("/work/dir");
  });
});