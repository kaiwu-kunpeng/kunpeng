# 鲲鹏自托管安装手册

本手册覆盖原生脚本、Docker Compose 与 systemd 三种部署方式。以下命令均从 META 仓根执行；`<目标仓>` 必须替换为鲲鹏要管理的项目绝对路径。

**先决条件**

- Linux 或 macOS；生产常驻示例以 Linux 为准。
- Node.js 20 或更高版本，以及随 Node 提供的 npm。
- Git。
- `node-pty` 需要原生编译工具链：Linux 准备 Python 3、`make`、GCC/G++（Debian/Ubuntu 可安装 `build-essential python3`）；macOS 安装 Xcode Command Line Tools。
- Docker 方式需要 Docker Engine 与 Compose v2；systemd 方式需要可用的 systemd。
- 目标仓与状态目录必须存在，并对运行用户可读写。
- 至少一个 AI 后端（Claude Code 或 Codex CLI）已安装并登录，见下一节。

**AI 后端前置**

鲲鹏的 `run` / `plan` 由本机的 Claude Code 或 Codex CLI 实际执行。只有驾驶舱能打开还不足以派流：运行鲲鹏的环境里必须至少有一个后端已安装并登录。

| 后端 | 安装命令 | 登录命令 | 状态命令 |
| --- | --- | --- | --- |
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `claude auth login` | `claude auth status` |
| Codex CLI | `npm install -g @openai/codex` | `codex login` | `codex login status` |

无浏览器的服务器可用 `codex login --device-auth` 完成 Codex 登录；Claude Code 可在有浏览器的机器上运行 `claude setup-token`，把取得的令牌设为服务器上的环境变量 `CLAUDE_CODE_OAUTH_TOKEN`，并确保运行鲲鹏的进程能读取该变量。

登录态属于运行鲲鹏的系统用户。systemd 以 `kunpeng` 用户运行时，要以该用户身份安装可访问的 CLI 并登录，不能只在自己的账号或 root 下登录。

`KUNPENG_BACKEND` 钉了 `claude` 或 `codex` 时，被指定的后端必须可用。双后端时，其中一个找不到或登录失效时，同一次调用会改用另一个。

运行 `./install.sh --check-backends` 可单独复查后端，不安装依赖、不构建。退出码 `0` 表示至少一个后端就绪，且被指定的后端（如有）就绪；退出码 `3` 表示没有可用后端或被指定的后端不可用，按提示安装或登录后再复查。

**方式一：原生一键安装**

```bash
chmod +x install.sh
./install.sh
```

脚本会检查 Node.js 主版本，安装 orchestrator 依赖并执行构建，最后检查 AI 后端；没有可用后端或被指定的后端不可用时退出码为 3，修好后用 `./install.sh --check-backends` 复查。检查通过后可前台启动：

```bash
cd orchestrator
node dist/cli.js serve 7777 --repo <目标仓>
```

默认只监听 `127.0.0.1`。打开 `http://127.0.0.1:7777/` 即可访问总控台。

**方式二：Docker Compose**

先创建宿主机目录并准备环境文件：

```bash
mkdir -p "$HOME/.kunpeng"
cp .env.example .env
```

编辑 `.env`，将 `KUNPENG_STATE` 和 `KUNPENG_REPO` 都改为宿主机上的真实绝对路径，然后启动：

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 kunpeng
```

Compose 将宿主机 `KUNPENG_STATE`（其中包括 state 与 captures）挂到容器的 `/var/lib/kunpeng`，将目标仓挂到 `/workspace/repo`，并只把容器的 `7777` 发布到宿主机 `127.0.0.1:7777`。

**容器身份与目录属主**

Compose 默认以镜像内置的 `node` 用户（uid/gid 1000）运行，这是非 root 的安全默认。容器进程身份必须能写入挂载进来的目标仓与状态目录，不要为了省事长期使用 root。

- Linux：分别执行 `id -u` 和 `id -g`，把结果的实际数字写入 `.env`，例如 `KUNPENG_UID=1000`、`KUNPENG_GID=1000`（在 shell 中可用 `KUNPENG_UID=$(id -u)`、`KUNPENG_GID=$(id -g)` 取得这些值）。也可以让挂载目录匹配默认身份：`sudo chown -R 1000:1000 "$KUNPENG_STATE" "$KUNPENG_REPO"`。
- macOS Docker Desktop：绑定挂载在容器内一律呈现为 root 属主，非 root uid 无法写入；在 `.env` 中设置 `KUNPENG_UID=0`、`KUNPENG_GID=0`。
- macOS Docker Desktop：`KUNPENG_STATE` 与 `KUNPENG_REPO` 必须位于 Docker Desktop 已共享的路径下（默认只共享家目录等少数路径）；放在 `/tmp` 等未共享路径时，容器内只会看到一个空目录，日志反复出现 `not a git repository`，状态目录也不会落回宿主机。

如果登录成功但总控台返回 **500**，执行 `docker compose logs kunpeng | grep EACCES`；出现权限错误即可确认是挂载目录属主问题。

首次启动会自动创建管理员账号 `admin` 并生成随机密码，密码只在日志里打印一次。用下面的命令取出密码并立刻保存：

```bash
docker compose logs kunpeng | grep -A3 首次启动
```

随后在浏览器打开 `http://127.0.0.1:7777/`，使用账号 `admin` 和刚才保存的密码登录。

**容器内的 AI 后端登录**

镜像已安装 Claude Code 和 Codex CLI。Compose 把 `CLAUDE_CONFIG_DIR` 指向 `/var/lib/kunpeng/backend-auth/claude`，把 `CODEX_HOME` 指向 `/var/lib/kunpeng/backend-auth/codex`；两个凭据目录都在持久化的状态目录内，重建容器不丢登录态。

首次登录前，在宿主机建好这两个目录（将 `<KUNPENG_STATE>` 替换为 `.env` 中的宿主机状态目录绝对路径），并按上面的目录属主说明确保容器运行用户可写；Codex 在 `CODEX_HOME` 不存在时会直接报错退出：

```bash
mkdir -p "<KUNPENG_STATE>/backend-auth/claude"
mkdir -p "<KUNPENG_STATE>/backend-auth/codex"
```

按需登录后端并确认状态：

```bash
docker compose exec kunpeng codex login --device-auth
docker compose exec kunpeng claude auth login
docker compose exec kunpeng codex login status
docker compose exec kunpeng claude auth status
```

`.env` 范例默认 `KUNPENG_BACKEND=codex`；只登录 Claude Code 时，改成 `claude` 或删掉该设置。也可在有浏览器的机器上用 `claude setup-token` 得到令牌，写进 `.env` 的 `CLAUDE_CODE_OAUTH_TOKEN`，再运行 `docker compose up -d` 让容器加载环境变量。

容器内监听 `0.0.0.0` 是必需的，否则宿主端口转发无法进入容器；安全由宿主端口只发布到 `127.0.0.1` 和登录鉴权共同保证。若要对局域网或公网开放，必须自行添加 TLS 与访问控制。

**方式三：systemd 常驻**

先用方式一完成安装，再创建专用用户和目录。下例中的安装路径、用户和目标仓路径需要按实际环境调整：

```bash
sudo install -d -o kunpeng -g kunpeng /var/lib/kunpeng
sudo install -d /etc/kunpeng
sudo cp deploy/systemd/kunpeng-serve.service /etc/systemd/system/
sudo editor /etc/systemd/system/kunpeng-serve.service
sudo systemctl daemon-reload
sudo systemctl enable --now kunpeng-serve.service
```

unit 通过 `ExecStart` 的 `--repo` 注入目标仓，通过 `KUNPENG_STATE` 注入共享状态目录。其他变量可写入 `/etc/kunpeng/kunpeng.env`；不要把真实密码或 token 放进仓库。

查看运行状态与日志：

```bash
systemctl status kunpeng-serve.service
journalctl -u kunpeng-serve.service -n 100 --no-pager
```

**验证步骤**

先确认构建产物、CLI 与 AI 后端：

```bash
node orchestrator/dist/cli.js version
./install.sh --check-backends
```

服务启动后验证 HTTP：

```bash
curl -fsS http://127.0.0.1:7777/ >/dev/null
```

最后在浏览器打开总控台，确认目标项目可见，并打开终端页面验证 `node-pty` 能创建交互会话。若失败，先查服务日志，再确认目标仓权限、`KUNPENG_STATE` 权限、Node.js 版本和本地编译工具链。

**升级与回滚**

升级前备份 `KUNPENG_STATE`，更新代码后重新运行 `./install.sh`，再重启 systemd 或重建 Docker 镜像。回滚代码时使用对应 Git 提交或镜像标签，状态目录保持独立，不要随镜像删除。
