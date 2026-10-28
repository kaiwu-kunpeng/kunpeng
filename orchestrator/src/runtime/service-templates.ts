import { dirname, join } from "node:path";
import {
  renderSystemdService,
  renderSystemdTimer,
  type DaemonScheduleSpec,
} from "./daemon-schedule.js";

export type ServicePlatform = "launchd" | "systemd";

export interface ServiceTopology {
  home: string;
  nodeBin: string;
  repoRoot: string;
  serveDir: string;
  cronDir: string;
  port: number;
  logDir: string;
  tunnel?: string;
  cloudflaredBin?: string;
}

export interface ServiceFile {
  file: string;
  content: string;
}

export function resolveServeRoot(env: Record<string, string | undefined>, home: string): string {
  return env.KUNPENG_SERVE_DIR || join(home, "kunpeng-serve");
}

export function resolveCronRoot(env: Record<string, string | undefined>, home: string): string {
  return env.KUNPENG_CRON_DIR || join(home, "kunpeng-cron");
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function renderLaunchdService(spec: DaemonScheduleSpec, logDir: string): string {
  const argumentsXml = [spec.binPath, ...spec.args]
    .map((argument) => `    <string>${xml(argument)}</string>`).join("\n");
  const environmentXml = Object.entries(spec.env ?? {})
    .map(([key, value]) => `    <key>${xml(key)}</key><string>${xml(value)}</string>`).join("\n");
  const schedule = spec.intervalSeconds > 0
    ? `<key>StartInterval</key><integer>${spec.intervalSeconds}</integer>`
    : "<key>KeepAlive</key><true/>";
  const secretHint = spec.label === "serve"
    ? "\n  <!-- 如需密钥，请仅在本机副本的 EnvironmentVariables 中自行补充。 -->"
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.kunpeng.${xml(spec.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>WorkingDirectory</key><string>${xml(spec.workingDir)}</string>
  <key>RunAtLoad</key><true/>
  ${schedule}${secretHint}
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>StandardOutPath</key><string>${xml(join(logDir, `${spec.label}.log`))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logDir, `${spec.label}.err.log`))}</string>
</dict>
</plist>
`;
}

export function renderServiceFiles(platform: ServicePlatform, topology: ServiceTopology): ServiceFile[] {
  const { home, nodeBin, repoRoot, serveDir, cronDir, port, logDir, tunnel } = topology;
  const env = {
    PATH: `${dirname(nodeBin)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: home,
    LANG: "en_US.UTF-8",
  };
  const specs: DaemonScheduleSpec[] = [
    {
      label: "serve", binPath: nodeBin,
      args: [join(serveDir, "orchestrator/dist/cli.js"), "serve", String(port)],
      intervalSeconds: 0, workingDir: join(serveDir, "orchestrator"), env,
    },
    {
      label: "autopilot", binPath: nodeBin,
      args: [join(cronDir, "orchestrator/dist/cli.js"), "autopilot", "--repo", repoRoot],
      intervalSeconds: 1800, workingDir: join(cronDir, "orchestrator"), env,
    },
    {
      label: "sync-cron", binPath: "/bin/bash",
      args: [join(cronDir, "deploy/scripts/sync-mirror.sh"), cronDir],
      intervalSeconds: 300, workingDir: cronDir, env,
    },
  ];
  if (tunnel) {
    specs.push({
      label: "tunnel", binPath: topology.cloudflaredBin ?? "/usr/local/bin/cloudflared",
      args: ["tunnel", "run", tunnel], intervalSeconds: 0, workingDir: home, env,
    });
  }

  return specs.flatMap((spec): ServiceFile[] => {
    if (platform === "launchd") {
      return [{ file: `com.kunpeng.${spec.label}.plist`, content: renderLaunchdService(spec, logDir) }];
    }
    const unit = `kunpeng-${spec.label}`;
    let content = `${renderSystemdService(spec)}EnvironmentFile=-%h/.config/kunpeng/kunpeng.env\n`;
    if (spec.intervalSeconds === 0) {
      content = content.replace("Type=oneshot", "Type=simple\nRestart=always");
      content += "\n[Install]\nWantedBy=default.target\n";
    }
    const files = [{ file: `${unit}.service`, content }];
    if (spec.intervalSeconds > 0) {
      files.push({ file: `${unit}.timer`, content: renderSystemdTimer(spec) });
    }
    return files;
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function serviceLoadHint(platform: ServicePlatform, outDir: string, files: ServiceFile[]): string {
  if (platform === "launchd") {
    return ["mkdir -p ~/Library/LaunchAgents", ...files.flatMap(({ file }) => [
      `cp ${shellQuote(join(outDir, file))} ~/Library/LaunchAgents/`,
      `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/${file}`,
    ]),
    "# 注意：上面的 launchctl bootstrap 只是让服务立即启动，手工装载的任务没有 managed LWCR，可能被 macOS 静默回收。",
    "# 复制完成后请注销并重新登录一次（或重启），让 launchd 从 ~/Library/LaunchAgents 原生装载；之后可用 launchctl print gui/$(id -u)/<Label> 确认 properties 含 LWCR。",
    ].join("\n");
  }
  const names = new Set(files.map(({ file }) => file));
  const enabled = files.filter(({ file }) => file.endsWith(".timer")
    || (file.endsWith(".service") && !names.has(file.replace(/\.service$/, ".timer"))));
  return [
    "mkdir -p ~/.config/systemd/user",
    ...files.map(({ file }) => `cp ${shellQuote(join(outDir, file))} ~/.config/systemd/user/`),
    "systemctl --user daemon-reload",
    ...enabled.map(({ file }) => `systemctl --user enable --now ${file}`),
  ].join("\n");
}
