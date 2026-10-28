import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { renderCrontabLine, renderLaunchdPlist } from "../loop/schedule.js";

export type DaemonPlatform = "launchd" | "systemd" | "unsupported";

export interface DaemonScheduleSpec {
  label: string;
  binPath: string;
  args: string[];
  intervalSeconds: number;
  workingDir: string;
  env?: Record<string, string>;
}

export interface DaemonIo {
  writeFile(path: string, content: string): Promise<void>;
  mkdirp(dir: string): Promise<void>;
  exec(cmd: string, args: string[]): void;
  rm(path: string): Promise<void>;
  homedir(): string;
}

const UNSUPPORTED_MESSAGE =
  "当前平台不支持后台调度(仅 macOS launchd / Linux systemd);可用外部 cron 定时调用同命令替代";

export function daemonPlatform(
  platform: NodeJS.Platform = process.platform,
): DaemonPlatform {
  if (platform === "darwin") return "launchd";
  if (platform === "linux") return "systemd";
  return "unsupported";
}

export function systemdUnitName(label: string): string {
  return `kunpeng-${label.replace(/[^A-Za-z0-9-]/g, "-")}`;
}

function quoteSystemdArgument(argument: string): string {
  if (!argument.includes(" ")) return argument;
  return `"${argument.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeSystemdEnvironment(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function renderSystemdService(spec: DaemonScheduleSpec): string {
  const execStart = [spec.binPath, ...spec.args.map(quoteSystemdArgument)].join(" ");
  const environment = Object.entries(spec.env ?? {})
    .map(
      ([key, value]) =>
        `Environment="${key}=${escapeSystemdEnvironment(value)}"`,
    )
    .join("\n");
  const environmentBlock = environment.length > 0 ? `\n${environment}` : "";

  return `[Unit]
Description=${spec.label}

[Service]
Type=oneshot
WorkingDirectory=${spec.workingDir}
ExecStart=${execStart}${environmentBlock}
`;
}

export function renderSystemdTimer(spec: DaemonScheduleSpec): string {
  return `[Unit]
Description=${spec.label}

[Timer]
OnBootSec=60
OnUnitActiveSec=${spec.intervalSeconds}
Persistent=true

[Install]
WantedBy=timers.target
`;
}

export function renderScheduleHint(opts: {
  platform: DaemonPlatform;
  intervalMinutes: number;
  command: string;
  label: string;
}): string {
  const crontabLine = renderCrontabLine({
    intervalMinutes: opts.intervalMinutes,
    command: opts.command,
  });

  if (opts.platform !== "systemd") {
    const platformNote =
      opts.platform === "launchd"
        ? "macOS 可将以下行加入 crontab（也可使用 launchd 安装调度）："
        : "当前平台不支持内建后台调度，请使用外部 cron：";
    return `${platformNote}
${crontabLine}`;
  }

  const [binPath = opts.command, ...args] = opts.command.trim().split(/\s+/);
  const spec: DaemonScheduleSpec = {
    label: opts.label,
    binPath,
    args,
    intervalSeconds: opts.intervalMinutes * 60,
    workingDir: "/",
  };
  const unitName = systemdUnitName(opts.label);

  return `将以下内容保存为 ~/.config/systemd/user/${unitName}.service：
${renderSystemdService(spec)}
将以下内容保存为 ~/.config/systemd/user/${unitName}.timer：
${renderSystemdTimer(spec)}
然后启用用户级定时器：
systemctl --user daemon-reload
systemctl --user enable --now ${unitName}.timer`;
}

function launchdPath(label: string, home: string): string {
  return `${home}/Library/LaunchAgents/${label}.plist`;
}

function systemdPaths(
  label: string,
  home: string,
): { dir: string; service: string; timer: string } {
  const dir = `${home}/.config/systemd/user`;
  const unit = systemdUnitName(label);
  return {
    dir,
    service: `${dir}/${unit}.service`,
    timer: `${dir}/${unit}.timer`,
  };
}

function tolerateNotLoaded(action: () => void): void {
  try {
    action();
  } catch {
    // An absent or inactive unit is already in the desired state.
  }
}

function assertSupported(platform: DaemonPlatform): asserts platform is Exclude<
  DaemonPlatform,
  "unsupported"
> {
  if (platform === "unsupported") throw new Error(UNSUPPORTED_MESSAGE);
}

export async function installDaemonSchedule(
  spec: DaemonScheduleSpec,
  platform: DaemonPlatform,
  io: DaemonIo,
): Promise<{ paths: string[] }> {
  assertSupported(platform);

  if (platform === "launchd") {
    const home = io.homedir();
    const dir = `${home}/Library/LaunchAgents`;
    const path = launchdPath(spec.label, home);
    await io.mkdirp(dir);
    await io.writeFile(path, renderLaunchdPlist(spec));
    tolerateNotLoaded(() => io.exec("launchctl", ["unload", path]));
    io.exec("launchctl", ["load", "-w", path]);
    return { paths: [path] };
  }

  const paths = systemdPaths(spec.label, io.homedir());
  const timerUnit = `${systemdUnitName(spec.label)}.timer`;
  await io.mkdirp(paths.dir);
  await io.writeFile(paths.service, renderSystemdService(spec));
  await io.writeFile(paths.timer, renderSystemdTimer(spec));
  io.exec("systemctl", ["--user", "daemon-reload"]);
  io.exec("systemctl", [
    "--user",
    "enable",
    "--now",
    timerUnit,
  ]);
  return { paths: [paths.service, paths.timer] };
}

export async function uninstallDaemonSchedule(
  label: string,
  platform: DaemonPlatform,
  io: DaemonIo,
): Promise<{ removed: string[] }> {
  assertSupported(platform);

  if (platform === "launchd") {
    const path = launchdPath(label, io.homedir());
    tolerateNotLoaded(() => io.exec("launchctl", ["unload", path]));
    await io.rm(path);
    return { removed: [path] };
  }

  const paths = systemdPaths(label, io.homedir());
  const timerUnit = `${systemdUnitName(label)}.timer`;
  tolerateNotLoaded(() =>
    io.exec("systemctl", [
      "--user",
      "disable",
      "--now",
      timerUnit,
    ]),
  );
  await io.rm(paths.service);
  await io.rm(paths.timer);
  io.exec("systemctl", ["--user", "daemon-reload"]);
  return { removed: [paths.service, paths.timer] };
}

export function realDaemonIo(): DaemonIo {
  return {
    writeFile: (path, content) => writeFile(path, content, "utf8"),
    mkdirp: async (dir) => {
      await mkdir(dir, { recursive: true });
    },
    exec: (cmd, args) => {
      execFileSync(cmd, args, { timeout: 15_000 });
    },
    rm: async (path) => {
      await rm(path, { force: true });
    },
    homedir: () => homedir(),
  };
}
