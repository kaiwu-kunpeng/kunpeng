import { afterEach, describe, expect, it } from "vitest";
import { codexAdapter } from "../../src/agent/backend-adapter.js";

const NET = "sandbox_workspace_write.network_access=true";
const savedNet = process.env.KUNPENG_CODEX_NETWORK;
const savedRoots = process.env.KUNPENG_CODEX_WRITABLE_ROOTS;
afterEach(() => {
  if (savedNet === undefined) delete process.env.KUNPENG_CODEX_NETWORK; else process.env.KUNPENG_CODEX_NETWORK = savedNet;
  if (savedRoots === undefined) delete process.env.KUNPENG_CODEX_WRITABLE_ROOTS; else process.env.KUNPENG_CODEX_WRITABLE_ROOTS = savedRoots;
});

function pairs(args: string[], flag: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => { if (a === flag && i + 1 < args.length) out.push(args[i + 1]!); });
  return out;
}

describe("安全5 联网与可写目录必须显式声明（作者锁定）", () => {
  it("默认不联网:不出现 network_access", () => {
    delete process.env.KUNPENG_CODEX_NETWORK;
    delete process.env.KUNPENG_CODEX_WRITABLE_ROOTS;
    const inv = codexAdapter.invoke({}, []);
    expect(inv.args.join(" ")).not.toContain("network_access");
    expect(inv.args).not.toContain("--add-dir");
  });

  it("KUNPENG_CODEX_NETWORK=1 → -c sandbox_workspace_write.network_access=true 相邻出现", () => {
    process.env.KUNPENG_CODEX_NETWORK = "1";
    const inv = codexAdapter.invoke({}, []);
    expect(pairs(inv.args, "-c")).toContain(NET);
    expect(inv.args[inv.args.indexOf("--sandbox") + 1]).toBe("workspace-write");
  });

  it("tools 含 websearch → 同时开 web_search 与沙箱联网", () => {
    delete process.env.KUNPENG_CODEX_NETWORK;
    const inv = codexAdapter.invoke({}, ["WebSearch"]);
    expect(pairs(inv.args, "-c")).toContain("tools.web_search=true");
    expect(pairs(inv.args, "-c")).toContain(NET);
  });

  it("KUNPENG_CODEX_WRITABLE_ROOTS:绝对路径去重成 --add-dir,相对路径跳过,位置在 --skip-git-repo-check 之后", () => {
    process.env.KUNPENG_CODEX_WRITABLE_ROOTS = ["/tmp/kp-a", "/tmp/kp-b", "relative/x", " /tmp/kp-a "].join(":");
    const inv = codexAdapter.invoke({ model: "gpt-5" }, []);
    expect(pairs(inv.args, "--add-dir")).toEqual(["/tmp/kp-a", "/tmp/kp-b"]);
    expect(inv.args.indexOf("--skip-git-repo-check")).toBeLessThan(inv.args.indexOf("--add-dir"));
    expect(inv.args.indexOf("--add-dir")).toBeLessThan(inv.args.indexOf("-m"));
  });
});