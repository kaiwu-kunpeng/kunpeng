# 部署总控台

鲲鹏总控台是一个常驻的本地 HTTP 服务，用来查看项目、工作流、人工门和运行状态。

## 最小启动方式

在终端运行：

```bash
kunpeng serve 7777
```

端口可以换成其它未被占用的端口。未写端口时默认使用 `7777`。

默认监听 `127.0.0.1`，只有本机可以访问。启动后打开 `http://localhost:7777`。

## 选择单项目或多项目模式

只管理一个项目时，明确传入仓库路径：

```bash
kunpeng serve 7777 --repo <项目仓库路径>
```

这会进入单项目模式，只显示 `--repo` 指定的仓库。也可以用 `KUNPENG_REPO` 提供默认仓库路径。

不传 `--repo`、也不设置 `KUNPENG_REPO` 时，总控台进入多项目注册表模式，聚合中央注册表里已经登记的项目。

如果你只维护一个固定仓库，单项目模式最直接；如果同一台机器维护多个项目，先登记项目，再使用多项目模式更方便。

## 开放局域网访问

先为总控台设置密码。密码从 `KUNPENG_AUTH_PASSWORD` 或标准输入读取，不会作为命令行参数出现：

```bash
printf '%s' '<强密码>' | kunpeng auth set-password
kunpeng serve 7777 --host 0.0.0.0
```

也可以先把密码放进当前进程环境，再运行 `kunpeng auth set-password`。不要把真实密码写进 shell 历史、脚本或仓库。

`--host 0.0.0.0` 会监听所有网卡，同一局域网内可用 `http://<本机局域网IP>:7777` 访问。

只要绑定地址不是回环地址，鲲鹏就会检查是否已经配置访问密码；没有密码时会拒绝启动。回环地址 `127.0.0.1`、`localhost` 和 `::1` 永远不会被这条安全检查拦截。

紧急调试时可显式设置 `KUNPENG_ALLOW_INSECURE=1` 跳过检查，但这会让可达该端口的人直接进入总控台，不建议使用，更不要用于公网暴露。

## 启动前检查

- 确认 Node.js 版本满足要求，且鲲鹏依赖已经安装。
- 确认端口没有被其它服务占用。
- 远程访问前先验证密码登录，再配置 HTTPS 反向代理或隧道。
- 多项目模式下先确认目标项目已经出现在中央注册表中。
- 命令选项可能随版本演进；不确定时以当前 CLI 的实际帮助为准。

## 安装与全局命令(npm)

以下步骤用于安装总控台(cockpit)及其 CLI。从 Git 仓库安装时，先克隆仓库，再进入 `orchestrator` 目录安装依赖：

```bash
git clone <仓库地址>
cd <仓库目录>/orchestrator
npm install
```

`npm install` 会触发 `prepare` 脚本并自动构建 `dist`，无需再手动运行 `npm run build`。

需要在全局使用 `kunpeng` 命令时，在 `orchestrator` 目录运行：

```bash
npm link
```

不挂载全局命令时，也可以从仓库根目录直接运行 `node orchestrator/dist/cli.js`。

升级时拉取最新代码并重新安装依赖；`prepare` 会自动重建 `dist`：

```bash
git pull
cd orchestrator
npm install
```

本机部署有时会把 `node_modules` 软链到既有检出，这属于本机特有形态。换机或交付他人时，必须在目标环境真实执行 `npm install`，不能依赖原机器上的软链。
