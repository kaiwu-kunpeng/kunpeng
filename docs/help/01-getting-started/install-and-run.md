# 安装与运行

本页说明如何在本机安装鲲鹏编排器、启动总控台并设置登录密码。

## 前置条件

- Node.js 20 或更高版本。
- git。
- macOS 是当前的一等公民平台。

鲲鹏的命令行与前台进程可以在具备相应依赖的环境中运行，但 **Linux 上后台调度能力暂不可用**。如果你依赖定时巡检等后台调度，请目前使用 macOS。

## 安装依赖并构建

进入仓库的 `orchestrator` 目录：

```bash
cd <鲲鹏仓库目录>/orchestrator
npm i
npm run build
```

`npm run build` 会把 TypeScript 编译到 `dist/`，命令行入口是 `dist/cli.js`。

如需直接从当前源码目录运行命令，可使用 `node dist/cli.js <命令>`；安装并配置好 `kunpeng` 可执行命令后，也可以使用下文的简写形式。

## 启动总控台

使用默认端口 7777 启动：

```bash
kunpeng serve
```

也可以显式指定端口：

```bash
kunpeng serve 7777
```

如果尚未配置 `kunpeng` 可执行命令，请在 `orchestrator` 目录运行：

```bash
node dist/cli.js serve 7777
```

进程启动后，在浏览器打开 `http://localhost:7777`。`serve` 是常驻前台进程，终端退出或进程结束时总控台也会停止。

## 设置登录密码

首次使用建议设置总控台登录密码：

```bash
export KUNPENG_AUTH_PASSWORD='<新密码>'
kunpeng auth set-password
```

`kunpeng auth set-password` 只从环境变量 `KUNPENG_AUTH_PASSWORD` 或标准输入读取密码，密码不作为命令行参数传递。

命令默认设置用户 `admin` 的密码。完成后重启总控台，新设置才会生效。

不要把真实密码写进仓库、帮助文档或可共享的脚本。

## 常见环境变量

| 变量 | 含义 | 默认值 |
|---|---|---|
| `KUNPENG_HOME` | 宪法与角色卡的来源，用于编译 `AGENTS.md`；只读，并与目标仓库解耦。 | 安装目录上层（`dist/..` 的上一级） |
| `KUNPENG_REPO` | 默认目标项目仓库路径。 | 当前目录 |
| `KUNPENG_STATE` | 跨项目运行时状态目录，中央注册表 `projects.json` 位于其中；它与只读的 `KUNPENG_HOME` 解耦。 | `~/.kunpeng/` |
| `KUNPENG_BACKEND` | 子 agent 后端，可选 `claude` 或 `codex`，均使用已登录的 CLI。 | `claude` |

命令显式传入目标仓库时，以对应命令接受的 `--repo <路径>` 为准；未传时再使用 `KUNPENG_REPO` 或当前目录。

## 下一步

服务能够打开后，继续阅读[5 分钟跑通第一个项目](first-project.md)，登记一个目标仓库并提交第一份方案。

