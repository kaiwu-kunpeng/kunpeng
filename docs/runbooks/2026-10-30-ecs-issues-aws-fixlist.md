# ECS 接线后问题修复清单（AWS 部署直接执行版）

> 时间线：2026-10-29 Claude OAuth 接线成功 → 2026-10-30 期间，阿里云 ECS（Ubuntu 26.04.1 / Docker 29.9.1）暴露的问题与修法。
> 用途：AWS 环境部署鲲鹏时对照执行，避免重踩。分支 `feat/aws-deploy` 已含全部仓库侧修复。
> 假设：仓库检出在 `/opt/kunpeng-src`，部署套件 `deploy/aws/`，已跑过 `setup-instance.sh`。

## A. 已随仓库修复（git pull 即继承，无需手工）

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| A1 | 容器内 `kunpeng` 命令不可用，只能 `node /opt/kunpeng/orchestrator/dist/cli.js` | 根 Dockerfile 只 `npm ci && npm run build`，package.json 的 `bin` 从未链接进 PATH | 根 Dockerfile 加 wrapper `/usr/local/bin/kunpeng`（commit `df3e181`） |
| A2 | 重跑 `setup-claude-code.sh` 会把 userns 配置重置（codex 沙箱再次全废） | 脚本内部 COMPOSE_ARGS 不含 userns.yml | 脚本自动检测并叠加 `docker-compose.userns.yml`（commit `df3e181`） |
| A3 | 下载 moby 默认 seccomp profile 时新版 URL 404 | moby 仓库 tag 变动 | 多候选 URL 循环回退 |
| A4 | AWS 套件缺 userns 文件 | 三件套只在 aliyun 套件演化 | `deploy/aws/seccomp-userns.json` + `deploy/aws/docker-compose.userns.yml` 已就位（本文档同批） |

## B. AWS 宿主机执行清单（按顺序）

### B1. userns 三件套 —— codex 沙箱（bwrap）能用

**症状**：codex `workspace-write` 模式全废。三层拦截错误码指纹（判别实验逐一验证过）：
- `unshare -Ur true` 报 **EPERM** → seccomp 层拦
- 报 **EACCES** → AppArmor 层（docker-default 对未声明 allow 的 mount 默认拒绝）
- 放行前两层后 **uid_map 写入失败** → 宿主 `apparmor_restrict_unprivileged_userns=1` 拦无 profile 进程（Ubuntu 23.10+ 默认）

**修法（三层缺一不可）**：
```bash
cd /opt/kunpeng-src
# 层1+2: seccomp profile + apparmor=unconfined(文件已随仓库, compose 引用即可)
# 层3: 宿主 sysctl —— 先判别 OS 是否需要:
unshare -Ur true && echo "宿主无限制,跳过层3" || {
  echo 'kernel.apparmor_restrict_unprivileged_userns=0' \
    > /etc/sysctl.d/99-kunpeng-userns.conf
  sysctl --system
}
```
说明：Amazon Linux 2023 无此限制可跳过层3；Ubuntu 24.04+ 需要。曾试过从 `/sys/kernel/security/apparmor/profiles` 提取 docker-default 源做精确 profile——那里只有名单无规则体，此路不通，直接用三件套。

### B2. 源码属主（git dubious ownership）

**症状**：git 命令报 `detected dubious ownership`。
**根因**：从 macOS rsync 同步源码会保留 uid 501 属主。
**修法**：`git clone` 则天然无此问题；若 rsync 同步，`chown -R root:root /opt/kunpeng-src`（或实例默认用户）。

### B3. `.env` 卫生

```bash
chmod 600 /opt/kunpeng-src/deploy/aws/.env
```
- **不写 `KUNPENG_BACKEND`**：ECS 踩过——写在 .env 经 env_file 注入 PID 1 后强制单后端，分阶段混合路由（spec/audit/review/verify→claude，implement→codex）失效。新部署直接不设这行；存量要改就注释掉 + 重建容器（env 值变化会触发 compose recreate，实测有效）。
- **代理**：AWS 出口 IP 若在 claude 支持区域（如美区）可直连，无需代理；若需代理，用 **CLI 级注入**（`settings.json` 的 `env` 字段，见 B5），不要容器级 `HTTPS_PROXY`（会把 codex 等全部流量也拖进代理）。Node 只认大写 `HTTPS_PROXY` 且不支持 socks5 URL，统一用 HTTP 代理。

### B4. 构建 / 重建语义（两个坑）

**坑1 —— 两段式构建**：compose 的 `build:` 只构建薄层（`deploy/aws/Dockerfile`，`FROM kunpeng-orchestrator:local`）。改了根 Dockerfile 或源码后，直接四文件链 `up -d --build` **不会**重建根镜像——ECS 上出现过"改完 wrapper 后容器里仍无 kunpeng 命令"。正确顺序：
```bash
cd /opt/kunpeng-src
docker build -t kunpeng-orchestrator:local -f Dockerfile .   # 先根镜像
docker compose -f deploy/aws/docker-compose.aws.yml \
   -f deploy/aws/docker-compose.claude-ext.yml \
   -f deploy/aws/docker-compose.userns.yml up -d --build     # 薄层链必须 --build(根镜像变了而薄层 Dockerfile 没变,不 --build 不重建)
# (80 端口被宿主占用时叠加 docker-compose.reuse-caddy.yml; setup-claude-code.sh 会自动判)
```
**坑2 —— compose 不感知文件内容变化**：`security_opt` 引用的是文件路径，seccomp json 内容变化**不触发** recreate（显示 Running 未动）。需要时补 `--force-recreate`。env_file 的值变化则会触发（实测）。

### B5. claude auto-update 报错（npm prefix 权限）

**症状**：claude 会话尾部报 `Auto-update failed: EACCES ... npm prefix`。
**根因**：容器内 node 用户（uid 1000）+ npm 全局目录 root 属主；auto-update 面向本机设计，容器内是预期现象。
**修法**（ECS 尚未落，AWS 建议直接做）：给 claude 配置加
```bash
# /data/<state>/backend-auth/claude/settings.json 的 "env" 块内加:
"DISABLE_AUTOUPDATER": "1"
```

### B6. 运维操作三条铁律（脚本化时必带）

1. `docker compose exec -T` 显式 `</dev/null`——否则宿主 heredoc 剩余部分透传进容器，被容器内 claude 会话当输入吃掉（ECS 实际发生过：②③④步全未执行）。
2. `docker run <镜像> <命令>` 测镜像必须 `--entrypoint sh`——否则命令被镜像 ENTRYPOINT（`node dist/cli.js`）当子命令吞掉。
3. 断言"失败"前等服务就绪（healthz 轮询）——chromium 自测曾在容器刚重建的未就绪窗口误报失败。

### B7. 项目级权限放行（被管理项目）

被管理项目（如 kaiwu）的 `.claude/settings.local.json` 里给 loop 派通用放行，避免每个 flow id 单条维护：
```json
{ "permissions": { "allow": ["Bash(kunpeng loop run:*)", "..."] } }
```

## C. 部署后验证清单（全绿才算成）

```bash
docker exec <容器> sh -c 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7777/healthz'  # 200
docker exec <容器> unshare -Ur true </dev/null && echo ok        # userns 三件套生效
docker exec <容器> kunpeng version </dev/null                    # wrapper 可用
docker exec <容器> sh -c 'cat /proc/1/environ | tr "\0" "\n" | grep -c KUNPENG_BACKEND' </dev/null  # 0(混合路由)
docker exec <容器> codex sandbox -- true </dev/null              # codex 沙箱真通(loop agent 视角)
# claude: 会话发 "reply pong" 走一次真实调用; MCP 列表 8/8 Connected
```
最后一条闭环验证：派一条最小冒烟流走 `kunpeng merge`，确认 loop agent 视角 codex 沙箱真通（ECS 的 `flow-smoke-test` 流已 verified）。

## D. 排障方法备忘

- **userns 错误码三层定位**：EPERM=seccomp / EACCES=AppArmor / uid_map 失败=sysctl。逐层放行、逐层复测。
- **launchd/服务"进不去"**：先 `curl 127.0.0.1:<端口>` 分清源站没起还是网络问题；看 `runs` 计数与 last exit code 判崩溃循环，隔一分钟再 print 一次看 runs 是否还在涨才是硬判据。
- **区域放行诊断**：`curl` 不带 key 裸打 API——401=穿透到认证层（区域放行）、403=被区域风控拦、405=到达路由层（同样证明放行）。
- **精确 grep**：查配置时用精确地址（如 `brd.superproxy.io`）而不是关键词 `proxy`——后者会被插件缓存文档里的英文单词大量误报。
