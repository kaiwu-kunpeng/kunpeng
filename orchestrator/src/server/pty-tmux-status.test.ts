import { describe, it, expect } from "vitest";
import { tmuxNewSessionArgs } from "./pty-tmux.js";

// 回归:tmux 默认 status on,status-left "[#S:#W*" 与 status-right 主机名引号会漏进
// xterm 渲染成乱码残影(实测 "[kp-pty-170:zsh*" + 行尾双引号,resize 叠多行)。
// new-session 命令序列必须链会话级 set-option status off。
describe("kp tmux 会话关闭状态栏(防状态栏漏进终端当乱码)", () => {
  it("命令序列以 ; set-option status off 收尾(会话级,无 -g)", () => {
    const args = tmuxNewSessionArgs({ sessionName: "kp-x", cwd: "/tmp" });
    expect(args.slice(-4)).toEqual([";", "set-option", "status", "off"]);
    expect(args).not.toContain("-g");
  });

  it("带 shell 时 shell 在分隔符之前(仍是 new-session 的启动命令)", () => {
    const args = tmuxNewSessionArgs({ sessionName: "kp-x", cwd: "/tmp", shell: "/bin/zsh" });
    expect(args.indexOf("/bin/zsh")).toBeGreaterThan(-1);
    expect(args.indexOf("/bin/zsh")).toBeLessThan(args.indexOf(";"));
    expect(args.slice(-4)).toEqual([";", "set-option", "status", "off"]);
  });

  it("全局 -u 仍打头,new-session 语义不变", () => {
    const args = tmuxNewSessionArgs({ sessionName: "kp-abc", cwd: "/work" });
    expect(args[0]).toBe("-u");
    expect(args[1]).toBe("new-session");
    expect(args[args.indexOf("-s") + 1]).toBe("kp-abc");
    expect(args[args.indexOf("-c") + 1]).toBe("/work");
  });
});