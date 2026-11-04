# ECS 全量变更手册（AWS 迁移执行版）

> 范围：2026-10-29 Claude OAuth 接线成功 → 2026-10-30，阿里云 ECS 上的**全部变更**、每项解决什么问题、AWS 上如何直接执行。
> 用法：按章节顺序在 AWS 执行即为完整部署主线。问题修复的排障细节见同目录 `2026-10-30-ecs-issues-aws-fixlist.md`。
> 环境：ECS = Ubuntu 26.04.1 / Docker 29.9.1；分支 `feat/aws-deploy`（含全部仓库侧修复）。

## 0. 变更总览（变更 → 解决什么问题）

| # | 变更 | 解决的问题 | 章节 |
|---|------|-----------|------|
| 1 | 目录规划（/data 三域） | 状态/项目/独立账号 CLI 数据隔离，重建容器不丢 | §1 |
| 2 | 源码检出 + 属主修正 | git dubious ownership（rsync 带 uid 501） | §1 |
| 3 | kunpeng wrapper 进根镜像 | 容器内 `kunpeng` 命令不可用（bin 未链接 PATH） | §2 |
| 4 | 两段式构建顺序 | compose 只建薄层，根镜像改动不生效 | §2 |
| 5 | userns 三件套 | codex 沙箱（bwrap）全废：EPERM/EACCES/uid_map 三层拦截 | §2 |
| 6 | Claude OAuth 接线（FIFO 喂 code） | 无浏览器服务器上完成订阅账号登录 | §3 |
| 7 | 代理 CLI 级注入（settings.json） | 账号区域风控（仅受限区域出口需要；AWS 美区可跳过） | §3 |
| 8 | DISABLE_AUTOUPDATER=1 | claude auto-update 的 npm prefix EACCES 报错 | §3 |
| 9 | Claude 能力增强五层（setup-claude-code.sh） | chromium 截图/中文字体/TS 工具链/插件/MCP 全不可用 | §4 |
| 10 | `.env` 卫生（不写 KUNPENG_BACKEND + 600） | 强制单后端掐死混合路由；密钥文件权限 | §5 |
| 11 | 项目级权限放行（loop run:*） | 每个 flow id 单条维护放行规则 | §5 |
| 12 | kaiwu 骨架（/opt/kaiwu/.env） | 独立账号 CLI 的配置位预埋 | §5 |

## 1. 基础层：目录规划 + 源码

```bash
# 数据盘三域隔离(ECS 实测布局,AWS 沿用):
# /data/kunpeng/lib    → KUNPENG_STATE(状态卷: backend-auth 登录态/captures 知识库/projects.json)
# /data/kunpeng/repos  → 被管理项目仓根(容器内 /workspace/repos)
# /data/kaiwu-cli      → kaiwu 独立账号 CLI(codex/claude 各自 home)
# /data/host-cli       → 宿主机 CLI(可选)
mkdir -p /data/kunpeng/lib /data/kunpeng/repos /data/kaiwu-cli

# 源码:git clone 天然无属主问题;若从 mac rsync 同步,必须修正属主(否则 git 报 dubious ownership):
git clone -b feat/aws-deploy <repo-url> /opt/kunpeng-src
# rsync 场景: chown -R root:root /opt/kunpeng-src
```

## 2. 容器层：构建 + userns 三件套

```bash
cd /opt/kunpeng-src
bash deploy/aws/setup-instance.sh          # 生成 deploy/aws/.env(域名/状态路径等)

# 两段式构建(顺序不可倒): 先根镜像(含 kunpeng wrapper),再薄层链
docker build -t kunpeng-orchestrator:local -f Dockerfile .
docker compose -f deploy/aws/docker-compose.aws.yml \
   -f deploy/aws/docker-compose.claude-ext.yml \
   -f deploy/aws/docker-compose.userns.yml up -d --build     # 薄层链必须 --build(根镜像变了而薄层 Dockerfile 没变,不 --build 不重建,实测踩过)

# 宿主 sysctl(userns 层3): 先判别,Ubuntu 24.04+ 需要,Amazon Linux 2023 跳过
unshare -Ur true 2>/dev/null || {
  echo 'kernel.apparmor_restrict_unprivileged_userns=0' > /etc/sysctl.d/99-kunpeng-userns.conf
  sysctl --system
}
```

**userns 三件套**（解决 codex 沙箱，文件已随仓库在 `deploy/aws/`）：
| 层 | 配置 | 拦了什么 |
|---|------|---------|
| 1 | `seccomp=./seccomp-userns.json`（compose 覆盖） | EPERM：seccomp 拦 unshare/clone(CLONE_NEWUSER) 等 8 个 syscall |
| 2 | `apparmor=unconfined`（compose 覆盖） | EACCES：docker-default 对未声明 allow 的 mount 默认拒绝 |
| 3 | 宿主 sysctl（上面命令） | uid_map 写入失败：Ubuntu 23.10+ 拦无 profile 进程的 userns |

**重建语义两个坑**：`security_opt` 引用的 seccomp json 内容变化不触发 recreate（需 `--force-recreate`）；env_file 值变化会触发（实测有效）。

## 3. 后端层：Claude 接线 + codex

### 3.1 Claude OAuth（无浏览器服务器，FIFO 喂 code）

```bash
# 容器内 CLAUDE_CONFIG_DIR 已由 compose 指到状态卷(登录态持久化,重建不丢):
#   /var/lib/kunpeng/backend-auth/claude  ← 宿主 /data/kunpeng/lib/backend-auth/claude
docker exec -it <容器> bash
mkfifo /tmp/cl-oauth; (cat /tmp/cl-oauth | claude auth login --claudeai > /tmp/cl-oauth.log 2>&1 &)
# 日志里取授权 URL → 本地浏览器完成授权 → 拿到 code 后:
echo '<code>' > /tmp/cl-oauth
claude -p 'reply pong'        # 验证登录态
```
版本注意：claude 2.1.312 认证归 `auth` 命令组（`claude auth login`）；`claude login` 会被当 prompt 参数。

### 3.2 代理（仅受限区域出口需要；AWS 美区直连可跳过）

**粒度选择**：CLI 级（settings.json 的 `env` 字段）——只影响 claude 进程；容器级 `HTTPS_PROXY` 会把 codex 等全部流量拖进代理，不要用。

```bash
# /data/kunpeng/lib/backend-auth/claude/settings.json 的 "env" 块:
"env": {
  "HTTPS_PROXY": "http://<user>:<pass>@brd.superproxy.io:44445",
  "NO_PROXY": "localhost,127.0.0.1"
}
```
Node 只认大写 `HTTPS_PROXY` 且不支持 socks5 URL，统一 HTTP 代理。验证用变异法：改错密码 → `ERR_PROXY_TUNNEL` 证明流量真走代理。

### 3.3 DISABLE_AUTOUPDATER

```bash
# 同一 settings.json 的 "env" 块内加(容器 node 用户 + npm 全局 root 属主,auto-update 必失败):
"DISABLE_AUTOUPDATER": "1"
```

### 3.4 codex

`CODEX_HOME` 已由 compose 指到状态卷；凭据从 ECS 迁移（scp `/data/kunpeng/lib/backend-auth/codex/` 整目录）或重登。codex 保持直连（不配代理）。

## 4. 能力增强层：一键脚本

```bash
cd /opt/kunpeng-src
bash deploy/scripts/setup-claude-code.sh --cloud aws --repo /workspace/repos/<主项目> \
  [--stitch-file <本机mjs>] [--docs-dir <本机战略稿目录>]
# 可选密钥(缺了自动跳过对应 MCP): GITHUB_PAT VERCEL_TOKEN NEON_API_KEY XCRAWL_KEY
# 或放 deploy/aws/.claude-ext-secrets.env(自动 chmod 600,须已被 .gitignore 覆盖)
```

脚本做五层（幂等可重跑，已自动叠加 userns.yml 不会重置沙箱配置）：
1. **镜像**：chromium + fonts-noto-cjk（中文不乱码）+ npm 全局（chrome-devtools-mcp / server-filesystem / typescript / typescript-language-server）
2. **compose**：shm_size 1gb（chrome-devtools 需要，默认 64M 崩）
3. **状态层**：seo-audit 技能 / stitch 脚本 / 战略稿目录落 KUNPENG_STATE
4. **容器内**：插件（superpowers / frontend-design / typescript-lsp）+ MCP 双通道——claude 用户级（人工会话）+ kunpeng 注册表（loop agent）
5. **验证**：chromium 无头截图自测 / 插件 / MCP 列表

MCP 清单（ECS 终态 8/8 Connected）：context7、cf-docs、github(PAT)、vercel、neon、kunpeng-codegraph、kunpeng-seo、chrome-devtools（xcrawl 已知损坏扣费，建议不装）。

## 5. 配置层

```bash
# .env 卫生:不写 KUNPENG_BACKEND(写了会强制单后端,掐死分阶段混合路由
#   spec/audit/review/verify→claude,implement→codex),并收紧权限:
chmod 600 /opt/kunpeng-src/deploy/aws/.env
# 存量要解除: 注释该行 + 重建容器(env 值变化触发 recreate,实测有效)

# 被管理项目权限放行(如 kaiwu),避免每个 flow id 单条维护:
# <项目>/.claude/settings.local.json:
{ "permissions": { "allow": ["Bash(kunpeng loop run:*)", "..."] } }

# kaiwu 独立账号骨架(可选,600 权限):
mkdir -p /opt/kaiwu && cat > /opt/kaiwu/.env <<'EOF'
CODEX_HOME=/data/kaiwu-cli/codex
CLAUDE_CONFIG_DIR=/data/kaiwu-cli/claude
# 代理位(出口B,按需): HTTPS_PROXY=...
# NEON_MIGRATION_DATABASE_URL=<占位>
EOF
chmod 600 /opt/kaiwu/.env
```

## 6. 部署后验证清单（全绿才算成）

```bash
docker exec <容器> sh -c 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7777/healthz'  # 200
docker exec <容器> unshare -Ur true </dev/null && echo ok        # userns 三件套
docker exec <容器> kunpeng version </dev/null                    # wrapper 可用
docker exec <容器> sh -c 'cat /proc/1/environ | tr "\0" "\n" | grep -c KUNPENG_BACKEND' </dev/null  # 0
docker exec <容器> codex sandbox -- true </dev/null              # codex 沙箱(loop agent 视角)
docker exec <容器> claude mcp list </dev/null                    # MCP 全 Connected
# claude 会话 'reply pong';chromium 截图含中文不乱码
# 终极闭环: 派最小冒烟流走 kunpeng merge(ECS flow-smoke-test 已 verified)
```

## 7. 运维铁律 + 排障备忘

- `docker compose exec -T` 一律 `</dev/null`（stdin 透传会污染容器内会话，ECS 实际发生过脚本后续步骤被 claude 吃掉）
- `docker run` 测镜像必须 `--entrypoint sh`（否则命令被 ENTRYPOINT 当子命令吞）
- 断言失败前等 healthz 就绪（chromium 自测曾误报）
- userns 错误码三层定位：EPERM=seccomp / EACCES=AppArmor / uid_map 失败=sysctl
- 区域诊断：curl 裸打 API，401=放行 / 403=风控拦 / 405=到达路由层
- 精确 grep（`brd.superproxy.io`）代替关键词 `proxy`（避免插件文档误报）
