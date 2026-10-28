#!/usr/bin/env bash
# 本机一键部署(SSH 通道,免手工逐条操作):
#   1. rsync 仓库到实例 /opt/kunpeng-src(增量,不删远端已有文件,不覆盖 .env)
#   2. 远端跑 setup-instance.sh(缺 Docker 会自动装;首跑生成 .env 模板)
#   3. 把域名/后端写进远端 .env(幂等;已有值会被本次参数覆盖)
#   4. 远端构建镜像 + 起容器 + 健康检查,首启时打印 admin 随机密码
#   5. 本机验证公网 HTTPS 入口
# 用法(在任意目录执行均可):
#   bash deploy/aliyun/deploy.sh [-i 密钥路径] <ssh目标> <域名> [codex|claude]
#   例:bash deploy/aliyun/deploy.sh -i ~/.ssh/aliyun.pem root@47.85.x.x kp.example.com
#   ssh目标可以是 user@host,或 ~/.ssh/config 里配好的别名(别名场景可不传 -i)
set -euo pipefail

# 可选 -i 密钥参数(非默认名密钥必须传)
KEY_ARG=""
if [ "${1:-}" = "-i" ]; then
  [ $# -ge 2 ] || { echo "用法: deploy.sh -i <密钥路径> <ssh目标> <域名> [后端]" >&2; exit 1; }
  KEY_FILE="$2"; [ -f "$KEY_FILE" ] || { echo "密钥不存在: $KEY_FILE" >&2; exit 1; }
  KEY_ARG="-i $KEY_FILE"
  shift 2
fi
SSH() { ssh $KEY_ARG "$@"; }

TARGET="${1:?用法: bash deploy/aliyun/deploy.sh [-i 密钥] <user@host|ssh别名> <域名> [codex|claude]}"
DOMAIN="${2:?缺少域名参数,例:kp.example.com}"
BACKEND="${3:-codex}"
REMOTE_DIR="/opt/kunpeng-src"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "[deploy] 1/5 同步代码到 $TARGET:$REMOTE_DIR ..."
RSH="ssh $KEY_ARG -o StrictHostKeyChecking=accept-new"
rsync -az -e "$RSH" --exclude node_modules --exclude dist \
  --exclude 'deploy/aliyun/.env' --exclude 'deploy/aws/.env' \
  "$REPO_ROOT/" "$TARGET:$REMOTE_DIR/"

# 远端无 .env → 首跑 setup 生成模板(该次以退出码 1 结束属预期)
if ! SSH -o StrictHostKeyChecking=accept-new "$TARGET" "test -f $REMOTE_DIR/deploy/aliyun/.env"; then
  echo "[deploy] 2/5 首次部署:生成 .env 模板 ..."
  SSH "$TARGET" "bash $REMOTE_DIR/deploy/aliyun/setup-instance.sh" \
    || echo "[deploy] (模板已生成,继续)"
  SSH "$TARGET" "cd $REMOTE_DIR/deploy/aliyun && \
    sed -i.bak 's|^KUNPENG_DOMAIN=.*|KUNPENG_DOMAIN=$DOMAIN|' .env && \
    sed -i.bak 's|^KUNPENG_BACKEND=.*|KUNPENG_BACKEND=$BACKEND|' .env && \
    rm -f .env.bak"
else
  echo "[deploy] 2/5 远端已有 .env,沿用(仅刷新域名/后端)..."
  SSH "$TARGET" "cd $REMOTE_DIR/deploy/aliyun && \
    sed -i.bak 's|^KUNPENG_DOMAIN=.*|KUNPENG_DOMAIN=$DOMAIN|' .env && \
    sed -i.bak 's|^KUNPENG_BACKEND=.*|KUNPENG_BACKEND=$BACKEND|' .env && \
    rm -f .env.bak"
fi

echo "[deploy] 3/5 远端构建+启动(数分钟,含 npm ci/build)..."
SSH "$TARGET" "bash $REMOTE_DIR/deploy/aliyun/setup-instance.sh"

echo "[deploy] 4/5 远端健康检查..."
SSH "$TARGET" "curl -fsS http://127.0.0.1:7777/healthz && echo ' <- healthz OK'"

echo "[deploy] 5/5 公网 HTTPS 验证(DNS/证书首次签发需 1-2 分钟,失败可稍后重试)..."
curl -fsSI "https://$DOMAIN/" | head -3 || {
  echo "[deploy] 公网入口暂未就绪:确认 DNS 已指向实例 IP、安全组已放行 80/443" >&2
  exit 1
}
echo "[deploy] 完成:https://$DOMAIN (admin 首启密码见上方输出,登录后立刻改密码)"
