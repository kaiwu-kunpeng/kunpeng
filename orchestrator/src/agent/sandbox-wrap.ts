// macOS seatbelt（sandbox-exec）文件系统围栏——纯函数 + 注入 IO。
// 默认 opt-in（cli-runner 里 KUNPENG_SANDBOX=1 才接线），失败一律 fail-safe。
// 模块顶层不碰真实 fs：所有 fs 访问都在函数内、且可被 SandboxDeps 覆盖。
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

/** 注入点：便于纯函数化测试，生产用真实 fs / process.platform。 */
export interface SandboxDeps {
  platform?: string;
  hasSandboxExec?: (path: string) => boolean;
  /** 解析真实路径；解析失败返回原值（不抛）。 */
  realpath?: (p: string) => string;
}

export interface SandboxDenyPaths {
  subpaths?: string[];
  literals?: string[];
}

function defaultRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function resolveDeps(deps?: SandboxDeps): Required<SandboxDeps> {
  return {
    platform: deps?.platform ?? process.platform,
    hasSandboxExec: deps?.hasSandboxExec ?? ((path) => existsSync(path)),
    realpath: deps?.realpath ?? defaultRealpath,
  };
}

/** 仅 macOS 且系统自带 sandbox-exec 时才可用；其余一律 false（fail-safe 不挡流）。 */
export function sandboxAvailable(deps?: SandboxDeps): boolean {
  const { platform, hasSandboxExec } = resolveDeps(deps);
  return platform === "darwin" && hasSandboxExec("/usr/bin/sandbox-exec");
}

/** 收集应放行写入的真实路径：cwd + extraTmp 各项；两处 node_modules（存在则）追加三缓存子目录。
 *  全部 realpath、去重、保插入序；空串或 realpath 抛错的条目跳过。 */
export function collectWriteScopes(cwd: string, extraTmp: string[], deps?: SandboxDeps): string[] {
  const { realpath } = resolveDeps(deps);
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (p: string): void => {
    if (!p) return;
    let real: string;
    try {
      real = realpath(p);
    } catch {
      return; // realpath 抛错的条目跳过
    }
    if (!real || seen.has(real)) return;
    seen.add(real);
    out.push(real);
  };

  add(cwd);
  for (const t of extraTmp) add(t);

  for (const base of [cwd, join(cwd, "orchestrator")]) {
    const nodeModules = join(base, "node_modules");
    if (existsSync(nodeModules)) {
      for (const sub of [".vite", ".vite-temp", ".cache"]) {
        add(join(nodeModules, sub));
      }
    }
  }

  return out;
}

/** 生成 seatbelt profile 文本：默认放行，禁一切写，再按 subpath 白名单放行写。
 *  /dev 恒在 subpath 末条；可选 deny 恒在全部 allow 之后。路径里的 " 与 \ 转义。 */
export function buildSandboxProfile(writeScopes: string[], deny?: SandboxDenyPaths): string {
  const esc = (p: string): string => p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const subpaths = [
    ...writeScopes.map((s) => `  (subpath "${esc(s)}")`),
    `  (subpath "/dev")`,
  ];
  const denyPaths = [
    ...(deny?.subpaths ?? []).map((p) => `  (subpath "${esc(p)}")`),
    ...(deny?.literals ?? []).map((p) => `  (literal "${esc(p)}")`),
  ];
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write*\n${subpaths.join("\n")})`,
    `(allow file-write* (regex #"^/private/tmp/claude-[^/]+"))`,
  ];
  if (denyPaths.length > 0) profile.push(`(deny file-write*\n${denyPaths.join("\n")})`);
  return [...profile, ""].join("\n");
}

export function governanceDenyPaths(cwd: string): SandboxDenyPaths {
  return {
    subpaths: [join(cwd, "constitution")],
    literals: [join(cwd, "AGENTS.md"), join(cwd, "SPEC-TEMPLATE.md")],
  };
}

/** 把原 spawn 参数包进 sandbox-exec：/usr/bin/sandbox-exec -f <profile> <原 file> <原 args…>。 */
export function wrapWithSandbox(
  file: string,
  args: string[],
  profilePath: string,
): { file: string; args: string[] } {
  return { file: "/usr/bin/sandbox-exec", args: ["-f", profilePath, file, ...args] };
}
