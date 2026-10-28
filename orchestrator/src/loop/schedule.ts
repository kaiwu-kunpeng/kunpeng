/**
 * 调度渲染 —— 纯函数，把调度配置渲染成 launchd plist 文本与 crontab 行。
 *
 * 无副作用、不读时钟、不触碰文件系统，只做字符串拼装（宪法 C8 确定性优先）。
 */

export interface LaunchdPlistOptions {
  label: string;
  binPath: string;
  args: string[];
  intervalSeconds: number;
  workingDir: string;
  /** 注入 launchd 任务环境变量。launchd 极简环境不继承 shell profile——需显式给 PATH/HOME/KUNPENG_BACKEND
   *  等，否则 codex/claude 等后端二进制找不到或用不到已登录态（drive 会"Not logged in"空转）。 */
  env?: Record<string, string>;
}

/** XML 文本转义（值里可能含 & < > 等，防 plist 损坏）。 */
function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 渲染 launchd plist XML 文本。相同入参恒返回相同字符串。
 */
export function renderLaunchdPlist(opts: LaunchdPlistOptions): string {
  const { label, binPath, args, intervalSeconds, workingDir, env } = opts;
  const programArguments = [binPath, ...args]
    .map((item) => `    <string>${xmlEscape(item)}</string>`)
    .join('\n');

  const envBlock = env && Object.keys(env).length
    ? `  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([k, v]) => `    <key>${xmlEscape(k)}</key><string>${xmlEscape(v)}</string>`).join('\n')}
  </dict>
`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
${envBlock}  <key>StartInterval</key><integer>${intervalSeconds}</integer>
  <key>WorkingDirectory</key><string>${xmlEscape(workingDir)}</string>
</dict>
</plist>
`;
}

export interface CrontabLineOptions {
  intervalMinutes: number;
  command: string;
}

/**
 * 渲染单行 crontab。相同入参恒返回相同字符串。
 */
export function renderCrontabLine(opts: CrontabLineOptions): string {
  const { intervalMinutes, command } = opts;
  return `*/${intervalMinutes} * * * * ${command}`;
}
