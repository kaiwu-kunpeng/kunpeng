#!/usr/bin/env bash
# 实例内配置脚本(在鲲鹏仓库根目录执行,可重复跑=幂等):
#   1. 校验/生成 deploy/aws/.env(必填项 fail-closed)
#   2. 构建 stock 镜像(kunpeng-orchestrator:local)→ AWS tmux 层镜像
#   3. docker compose 起 kunpeng + caddy
#   4. 首启时从日志取 admin 随机密码(只打印一次,立即保存)
# 用法:ssh 进实例后,在 /opt/kunpeng-src 内执行 bash deploy/aws/setup-instance.sh
set -euo pipefail

cd "$(dirname "$0")/../.."   # 仓库根
COMPOSE="docker compose -f deploy/aws/docker-compose.aws.yml"

ENV_FILE="deploy/aws/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
# 必填三项
KUNPENG_STATE=/var/lib/kunpeng
KUNPENG_REPOS=/srv/repos
KUNPENG_DOMAIN=替换为你的域名
# 容器运行身份(需能写上面两个目录;fresh EC2 上 1000=ubuntu)
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

# 目录与属主(与 user-data.sh 一致,补齐手工建的实例)
install -d -o "$UID_N" -g "$GID_N" -m 0755 "$REPOS" /opt/kunpeng-src
install -d -o "$UID_N" -g "$GID_N" -m 0700 "$STATE" "$STATE/backend-auth/claude" "$STATE/backend-auth/codex"

# 状态目录无 auth.json → 视为首启,起完后要取随机密码
FIRST_BOOT=0
[ -f "$STATE/auth.json" ] || FIRST_BOOT=1

# 构建:先 stock(基镜像),再 AWS 层(tmux)——顺序不可颠倒(层镜像 FROM 基镜像)
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
  echo "后续:登录总控台后立刻改密码;后端登录与项目登记见 deploy/aws/README.md。"
else
  echo "[setup] 存量状态,沿用已有账号密码。当前状态:"
  $COMPOSE ps
fi
