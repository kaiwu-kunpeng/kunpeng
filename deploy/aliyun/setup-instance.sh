#!/usr/bin/env bash
# 阿里云 ECS 实例内配置脚本(在鲲鹏仓库根目录执行,可重复跑=幂等):
#   0. Docker/compose 插件缺失则安装(国际站网络直连官方源;已有实例可能是裸机)
#   1. 校验/生成 deploy/aliyun/.env(必填项 fail-closed)
#   2. 构建 stock 镜像(kunpeng-orchestrator:local)→ aliyun tmux 层镜像
#   3. docker compose 起 kunpeng + caddy
#   4. 首启时从日志取 admin 随机密码(只打印一次,立即保存)
# 用法:代码 rsync/git 到实例后,在仓库根目录执行 bash deploy/aliyun/setup-instance.sh
set -euo pipefail

cd "$(dirname "$0")/../.."   # 仓库根

# 宿主机 80 端口已有入口(如 host 网络 Caddy)→ 叠加 override 禁用套件自带 caddy,复用现有入口
COMPOSE_FILES="deploy/aliyun/docker-compose.aliyun.yml"
if ss -tln 2>/dev/null | grep -qE ':(80|443) '; then
  echo "[setup] 检测到宿主机已有 80/443 入口,套件自带 caddy 禁用(复用现有入口反代 127.0.0.1:7777)"
  COMPOSE_FILES="$COMPOSE_FILES -f deploy/aliyun/docker-compose.reuse-caddy.yml"
fi
COMPOSE="docker compose -f $COMPOSE_FILES"

# ── 0. Docker 运行时(幂等:已装跳过) ─────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "[setup] 未检测到 Docker,走官方脚本安装(国际站网络可达)..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
# compose v2 插件必须存在(本套件用到 env_file required 语法;v1 docker-compose 不支持)
if ! docker compose version >/dev/null 2>&1; then
  echo "[setup] 缺 docker compose 插件(v2),安装 docker-compose-plugin 后重跑" >&2
  exit 1
fi

ENV_FILE="deploy/aliyun/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
# 必填三项
KUNPENG_STATE=/var/lib/kunpeng
KUNPENG_REPOS=/srv/repos
KUNPENG_DOMAIN=替换为你的域名
# 容器运行身份(需能写上面两个目录;Ubuntu 云镜像默认用户 uid=1000,root 登录的实例也用 1000)
KUNPENG_UID=1000
KUNPENG_GID=1000
# AI 后端:codex | claude;留空按阶段路由
KUNPENG_BACKEND=codex
# 可选:Claude Code 长期令牌(在有浏览器的机器上 claude setup-token 取得),勿提交
# CLAUDE_CODE_OAUTH_TOKEN=
EOF
  echo "[setup] 已生成 $ENV_FILE 模板;填好 KUNPENG_DOMAIN(及可选 token)后重跑本脚本"
  exit 1
fi

# 必填项守卫:fail-closed
get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'; }
for var in KUNPENG_STATE KUNPENG_REPOS KUNPENG_DOMAIN; do
  val="$(get "$var")"
  if [ -z "$val" ] || [ "${val#替换为}" != "$val" ]; then
    echo "[setup] $ENV_FILE 里 $var 未填" >&2
    exit 1
  fi
done
STATE="$(get KUNPENG_STATE)"
REPOS="$(get KUNPENG_REPOS)"
UID_N="$(get KUNPENG_UID)"; [ -n "$UID_N" ] || UID_N=1000
GID_N="$(get KUNPENG_GID)"; [ -n "$GID_N" ] || GID_N=1000

# 目录与属主(与 README 的目录布局一致)。
# 注:极简镜像可能没有 uid 1000 的对应用户名,install -o 会拒绝数字 uid,故统一 chown 兜底。
install -d -m 0755 "$REPOS" /opt/kunpeng-src
install -d -m 0700 "$STATE" "$STATE/backend-auth/claude" "$STATE/backend-auth/codex"
chown "$UID_N:$GID_N" "$REPOS" /opt/kunpeng-src
chown -R "$UID_N:$GID_N" "$STATE"

# 状态目录无 auth.json → 视为首启,起完后要取随机密码
FIRST_BOOT=0
[ -f "$STATE/auth.json" ] || FIRST_BOOT=1

# 构建:先 stock(基镜像),再 aliyun 层(tmux)——顺序不可颠倒(层镜像 FROM 基镜像)
docker build -t kunpeng-orchestrator:local -f Dockerfile .
$COMPOSE up -d --build

echo "[setup] 容器已启动,等待健康检查..."
CTR="$($COMPOSE ps -q kunpeng)"
for _ in $(seq 1 40); do
  STATUS="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' "$CTR" 2>/dev/null || echo starting)"
  [ "$STATUS" = "healthy" ] && break
  sleep 3
done
if [ "$STATUS" != "healthy" ]; then
  echo "[setup] 健康检查未通过,看日志:$COMPOSE logs --tail=100 kunpeng" >&2
  exit 1
fi

if [ "$FIRST_BOOT" = 1 ]; then
  echo "================ 首启 admin 随机密码(只此一次,立即保存) ================"
  $COMPOSE logs kunpeng | grep -A4 "首次启动"
  echo "===================================================================="
  echo "后续:登录总控台后立刻改密码;后端登录与项目登记见 deploy/aliyun/README.md。"
else
  echo "[setup] 存量状态,沿用已有账号密码。当前状态:"
  $COMPOSE ps
fi
