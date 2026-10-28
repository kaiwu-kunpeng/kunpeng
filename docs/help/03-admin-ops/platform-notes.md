# 平台说明与限制

鲲鹏以 macOS 作为开发和运行的主平台。核心 CLI 在其它平台可能可以运行，但部分运维能力依赖 macOS 系统组件。

## Node.js 要求

运行鲲鹏需要 Node.js 20 或更高版本。先确认：

```bash
node --version
```

版本过低时，应先升级 Node，再安装依赖和启动总控台。

## macOS

macOS 是一等公民，日常开发、总控台、终端会话以及后台定时调度都以它为主要验证平台。

`scout`、`maintain`、`patrol`、`ops` 和 `flywheel` 的 `--install` 会生成并安装 launchd 调度配置。对应的 `--uninstall` 用于移除该调度。

launchd 启动环境比交互式 shell 精简。后台任务需要的 PATH、登录态目录和鲲鹏环境变量，应由调度配置显式提供，不能假设 shell profile 会自动加载。

## Linux 与 Windows

Linux 和 Windows 目前不能使用上述命令的 `--install` 后台调度能力，因为该实现依赖 launchd 和 macOS 的 LaunchAgents 目录。

替代方案是先以前台常驻方式运行需要持续工作的命令，再用操作系统自己的调度器定时调用对应 CLI 子命令。

Linux 可用 cron 或 systemd timer 定时调用 `kunpeng scout`、`kunpeng maintain`、`kunpeng patrol`、`kunpeng ops` 或 `kunpeng flywheel`。

Windows 可使用任务计划程序调用相应命令。具体参数和服务账号环境以当前 CLI 帮助及操作系统文档为准。

外部调度时务必设置正确的工作目录、PATH、`KUNPENG_REPO`、后端登录态目录和必要环境变量，并把 stdout、stderr 留到可排查的日志中。

## tmux 依赖

总控台内的持久终端功能依赖 tmux。未安装 tmux 时，总控台的终端会话复用和恢复能力不可用。

macOS 常见安装方式是使用系统包管理器安装 tmux；Linux 则使用发行版包管理器。安装后重启 `kunpeng serve`，让总控台重新探测它。

tmux 只影响终端相关功能，不代表整个总控台和其它 CLI 都无法运行。

## 上线前检查

- `node --version` 显示 20 或更高版本。
- macOS 后台任务能在 `launchd` 中看到并产生预期日志。
- Linux/Windows 已由外部调度器接管周期任务，没有调用不受支持的 `--install`。
- 需要总控台终端时，`tmux` 已安装并能从服务进程的 PATH 中找到。
- 涉及后端调用时，服务账号拥有正确的 Claude 或 Codex 登录态。

遇到平台差异时，先把命令以前台方式运行一次，确认 CLI 本身正常，再排查调度器、权限和环境变量。

