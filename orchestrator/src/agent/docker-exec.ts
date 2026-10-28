/** 执行后端（第一刀）：把「在 cwd 用 env 跑 file args」翻译成 `docker run`，让 agent 进程跑在本机容器里。
 *  worktree 按同一路径挂进容器、以宿主 uid:gid 运行（写回的文件属主不变）；环境变量只传名字、值由 docker 进程继承，
 *  密钥不出现在进程参数里。colima/Docker Desktop 只共享部分宿主目录（默认 $HOME），cwd 不在共享根下时容器里的写入
 *  会静默丢失——这里直接报错（fail-closed）。 */
import { homedir } from "node:os";
import { resolve, sep } from "node:path";

export interface DockerExecBackend {
  kind: "docker";
  image: string;
  /** 宿主上被容器运行时共享进虚拟机的根目录；缺省 [$HOME]。 */
  sharedRoots?: string[];
  /** 额外挂载（docker -v 语法），如只读工具链。 */
  extraMounts?: string[];
}

export type ExecBackendConfig = DockerExecBackend;

/** 宿主专属、进容器会误导或泄露宿主路径的变量：不传。 */
const HOST_ONLY_ENV = new Set(["PATH", "HOME", "TMPDIR", "SHELL", "USER", "LOGNAME", "PWD", "OLDPWD", "TERM", "TERM_PROGRAM"]);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isUnder(path: string, root: string): boolean {
  const p = resolve(path);
  const r = resolve(root);
  return p === r || p.startsWith(r.endsWith(sep) ? r : r + sep);
}

export function dockerRunArgs(
  backend: DockerExecBackend,
  file: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  interactive: boolean,
  ids: { uid: number; gid: number } = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 },
): string[] {
  const roots = backend.sharedRoots ?? [homedir()];
  if (!roots.some((root) => isUnder(cwd, root))) {
    throw new Error(`docker 执行后端：工作目录 ${cwd} 不在共享根（${roots.join("、")}）之下，容器内写入会丢失`);
  }
  const envNames = Object.keys(env)
    .filter((name) => ENV_NAME.test(name) && !HOST_ONLY_ENV.has(name) && !name.startsWith("DOCKER_"))
    .sort();
  return [
    "run", "--rm", "--init",
    ...(interactive ? ["-i"] : []),
    "--user", `${ids.uid}:${ids.gid}`,
    "-v", `${cwd}:${cwd}`,
    "-w", cwd,
    ...(backend.extraMounts ?? []).flatMap((mount) => ["-v", mount]),
    ...envNames.flatMap((name) => ["-e", name]),
    backend.image,
    file,
    ...args,
  ];
}

/** 执行目标：配了 docker 后端就改写成 docker run，否则原样。 */
export function resolveSpawnTarget(
  backend: ExecBackendConfig | undefined,
  file: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  interactive: boolean,
): { file: string; args: string[] } {
  if (!backend) return { file, args };
  return { file: "docker", args: dockerRunArgs(backend, file, args, cwd, env, interactive) };
}
