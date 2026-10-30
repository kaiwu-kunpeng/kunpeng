#!/usr/bin/env bash
# setup-claude-code.sh — 在 ECS/EC2 宿主机一键初始化 Claude Code 环境（鲲鹏容器形态）
#
# 在鲲鹏仓库根目录执行（宿主机，需 docker + compose v2）。做五件事：
#   1. 镜像层：给 deploy/<cloud>/Dockerfile 追加 chromium + 中文字体 + npm 全局包，重建镜像
#   2. compose 层：生成 shm_size=1gb 覆盖文件（chrome-devtools 需要，默认 64M 会崩）
#   3. 状态层：seo-audit 技能（取自仓库 skills/）/ stitch 脚本 / 战略稿目录 落进 KUNPENG_STATE
#   4. 容器内：装 2 个插件；两条通道注册 MCP——claude 用户级（人工会话）+ kunpeng 注册表（loop agent）
#   5. 验证：chromium 无头截图自测、插件/MCP 列表
#
# 用法:
#   deploy/scripts/setup-claude-code.sh [--cloud aliyun|aws] [--repo /workspace/repos/<项目>] \
#       [--skip-build] [--stitch-file <本机路径>] [--docs-dir <本机路径>] [--extra-compose <file>]
#
# 可选密钥（缺了自动跳过对应 MCP，不报错）:
#   GITHUB_PAT  VERCEL_TOKEN  NEON_API_KEY  XCRAWL_KEY
#   也可放 deploy/<cloud>/.claude-ext-secrets.env（自动 chmod 600；须已被 .gitignore 覆盖）
#
# 幂等：可重复执行；Dockerfile/compose 用标记块防重复，MCP 先移除（不存在时失败属预期）再注册。
# 注意：kunpeng mcp add 的 --arg 值不能以 -- 开头（CLI 校验拒绝），需要 flag 的命令用
#       `--command sh --arg -c --arg '<整条命令>'` 包装；--repo 用 --env KUNPENG_REPO 传。

set -euo pipefail

CLOUD="" MAIN_REPO="" SKIP_BUILD=0 STITCH_FILE="" DOCS_DIR=""
EXTRA_COMPOSE_FILES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cloud) CLOUD="${2:?}"; shift 2 ;;
    --repo) MAIN_REPO="${2:?}"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --stitch-file) STITCH_FILE="${2:?}"; shift 2 ;;
    --docs-dir) DOCS_DIR="${2:?}"; shift 2 ;;
    --extra-compose) EXTRA_COMPOSE_FILES+=("${2:?}"); shift 2 ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[1;32m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 定位仓库与云套件 ----------
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "请在鲲鹏仓库内执行"
if [[ -z "$CLOUD" ]]; then
  if [[ -f "$REPO_ROOT/deploy/aliyun/docker-compose.aliyun.yml" ]]; then CLOUD=aliyun
  elif [[ -f "$REPO_ROOT/deploy/aws/docker-compose.aws.yml" ]]; then CLOUD=aws
  else die "未找到 deploy/<cloud> 套件，请用 --cloud 指定"; fi
fi
case "$CLOUD" in
  aliyun) COMPOSE_FILE="deploy/aliyun/docker-compose.aliyun.yml"
          ENV_FILE="$REPO_ROOT/deploy/aliyun/.env"
          DOCKERFILE="$REPO_ROOT/deploy/aliyun/Dockerfile" ;;
  aws)    COMPOSE_FILE="deploy/aws/docker-compose.aws.yml"
          ENV_FILE="$REPO_ROOT/deploy/aws/.env"
          DOCKERFILE="$REPO_ROOT/deploy/aws/Dockerfile" ;;
  *) die "未知云: $CLOUD（支持 aliyun|aws）" ;;
esac
SERVICE="${KUNPENG_SERVICE:-kunpeng}"
[[ -f "$ENV_FILE" ]] || die "缺 $ENV_FILE（先跑 setup-instance.sh）"

read_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' ; }
STATE_HOST="$(read_env KUNPENG_STATE)"; [[ -n "$STATE_HOST" ]] || die "$ENV_FILE 缺 KUNPENG_STATE"
REPOS_HOST="$(read_env KUNPENG_REPOS)"

# ---------- 密钥（环境变量优先，其次 secrets 文件） ----------
SECRETS_FILE="$REPO_ROOT/deploy/$CLOUD/.claude-ext-secrets.env"
if [[ -f "$SECRETS_FILE" ]]; then
  git -C "$REPO_ROOT" check-ignore -q "$SECRETS_FILE" \
    || die "$SECRETS_FILE 未被 .gitignore 覆盖，密钥有入库风险；先加忽略规则再跑"
  chmod 600 "$SECRETS_FILE"
  set -a; . "$SECRETS_FILE"; set +a
fi

# ---------- 主项目（容器内路径） ----------
if [[ -z "$MAIN_REPO" ]]; then
  if [[ -n "$REPOS_HOST" && -d "$REPOS_HOST" ]]; then
    mapfile -t repos < <(ls -1 "$REPOS_HOST" | grep -v '^\.')
    if [[ ${#repos[@]} -eq 1 ]]; then MAIN_REPO="/workspace/repos/${repos[0]}"
    elif [[ ${#repos[@]} -gt 1 ]]; then die "仓库根有多个项目: ${repos[*]}，请用 --repo /workspace/repos/<项目> 指定"
    fi
  fi
fi
[[ -n "$MAIN_REPO" ]] || die "请用 --repo /workspace/repos/<项目> 指定 codegraph/seo 分析的主项目"

# ---------- Phase 1: 镜像层（程序进镜像，重建可还原） ----------
if ! grep -q 'claude-ext-managed' "$DOCKERFILE"; then
  log "Dockerfile 追加 chromium/中文字体/npm 全局包（标记块，幂等）"
  cat >> "$DOCKERFILE" <<'EOF'

# >>> claude-ext-managed（setup-claude-code.sh 维护，勿手改）>>>
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g chrome-devtools-mcp @modelcontextprotocol/server-filesystem \
    typescript typescript-language-server
USER node
# <<< claude-ext-managed <<<
EOF
fi

OVERRIDE="deploy/$CLOUD/docker-compose.claude-ext.yml"
if [[ ! -f "$REPO_ROOT/$OVERRIDE" ]]; then
  log "生成 compose 覆盖文件 $OVERRIDE（shm_size 1gb）"
  cat > "$REPO_ROOT/$OVERRIDE" <<EOF
# setup-claude-code.sh 生成：chrome-devtools MCP 需要 >=1g /dev/shm（默认 64M 会崩）
services:
  $SERVICE:
    shm_size: "1gb"
EOF
fi

# 宿主机 80 已被占用且存在 reuse-caddy 覆盖 → 自动叠加，避免误启套件自带 caddy（与 setup-instance.sh 同判据）
port80_listening() { (ss -ltn 2>/dev/null || lsof -nP -iTCP:80 -sTCP:LISTEN 2>/dev/null) | grep -q ':80 '; }
REUSE_CADDY="deploy/$CLOUD/docker-compose.reuse-caddy.yml"
COMPOSE_ARGS=(-f "$COMPOSE_FILE" -f "$OVERRIDE")
if [[ "$CLOUD" == aliyun && -f "$REPO_ROOT/$REUSE_CADDY" ]] && port80_listening; then
  COMPOSE_ARGS+=(-f "$REUSE_CADDY"); log "检测到 80 端口被占，已叠加 reuse-caddy 覆盖"
fi
# userns 覆盖存在即叠加（codex 沙箱三件套），防止重跑本脚本时 security_opt 被重置
USERNS_FILE="deploy/$CLOUD/docker-compose.userns.yml"
if [[ -f "$REPO_ROOT/$USERNS_FILE" ]]; then
  COMPOSE_ARGS+=(-f "$USERNS_FILE"); log "检测到 userns 覆盖，已叠加（codex 沙箱）"
fi
for f in "${EXTRA_COMPOSE_FILES[@]:-}"; do
  [[ -n "$f" ]] && COMPOSE_ARGS+=(-f "$f")   # 额外 compose 覆盖文件（可多次）
done

log "重建镜像与容器（数据全在 bind mount，不丢登录态/配置）"
if [[ $SKIP_BUILD -eq 0 ]]; then
  (cd "$REPO_ROOT" && docker compose "${COMPOSE_ARGS[@]}" up -d --build)
else
  (cd "$REPO_ROOT" && docker compose "${COMPOSE_ARGS[@]}" up -d)
fi

# ---------- Phase 2: 状态层（宿主机落文件，容器内 /var/lib/kunpeng 可见） ----------
log "落状态层文件到 $STATE_HOST"
SKILLS_DIR="$STATE_HOST/backend-auth/claude/skills"
if [[ -d "$REPO_ROOT/skills/seo-audit" ]]; then
  mkdir -p "$SKILLS_DIR"; rm -rf "$SKILLS_DIR/seo-audit"
  cp -r "$REPO_ROOT/skills/seo-audit" "$SKILLS_DIR/"
else
  warn "仓库无 skills/seo-audit，跳过技能安装"
fi
STITCH_HOST="$STATE_HOST/bin/stitch-mcp-slim.mjs"
if [[ -n "$STITCH_FILE" ]]; then mkdir -p "$STATE_HOST/bin"; cp "$STITCH_FILE" "$STITCH_HOST"; fi
[[ -f "$STITCH_HOST" ]] || warn "缺 stitch-mcp-slim.mjs（从老机器拷到 $STITCH_HOST 或用 --stitch-file），将跳过 stitch MCP"
DOCS_HOST="$STATE_HOST/strategy-docs"
if [[ -n "$DOCS_DIR" ]]; then mkdir -p "$DOCS_HOST"; cp -r "$DOCS_DIR/." "$DOCS_HOST/"; fi
[[ -d "$DOCS_HOST" && -n "$(ls -A "$DOCS_HOST" 2>/dev/null)" ]] || warn "缺战略稿目录（rsync 到 $DOCS_HOST 或用 --docs-dir），将跳过 fs-docs MCP"

# ---------- Phase 3: 密钥写入 .env（供 kunpeng 注册表 ${VAR} 占位符在 loop 运行时解析） ----------
append_env() { # $1=变量名 $2=值；已存在则跳过（用户自管理）
  grep -qE "^$1=" "$ENV_FILE" && return 0
  printf '\n# claude-ext（setup-claude-code.sh 追加）\n%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}
[[ -n "${GITHUB_PAT:-}" ]]   && append_env GITHUB_PAT   "$GITHUB_PAT"
[[ -n "${VERCEL_TOKEN:-}" ]] && append_env VERCEL_TOKEN "$VERCEL_TOKEN"

# ---------- Phase 4: 容器内初始化（插件 + 两条 MCP 通道 + 验证） ----------
log "容器内注册插件与 MCP（约 1-3 分钟）"
EXEC_ARGS=(exec -T -e MAIN_REPO="$MAIN_REPO")
[[ -n "${GITHUB_PAT:-}" ]]   && EXEC_ARGS+=(-e GITHUB_PAT)
[[ -n "${VERCEL_TOKEN:-}" ]] && EXEC_ARGS+=(-e VERCEL_TOKEN)
[[ -n "${NEON_API_KEY:-}" ]] && EXEC_ARGS+=(-e NEON_API_KEY)
[[ -n "${XCRAWL_KEY:-}" ]]   && EXEC_ARGS+=(-e XCRAWL_KEY)

(cd "$REPO_ROOT" && docker compose "${COMPOSE_ARGS[@]}" "${EXEC_ARGS[@]}" "$SERVICE" bash -s) <<'EOS'
set -euo pipefail
log() { printf '[in-container] %s\n' "$*"; }
warn() { printf '[in-container][warn] %s\n' "$*" >&2; }
KP="node /opt/kunpeng/orchestrator/dist/cli.js"
CLI=/opt/kunpeng/orchestrator/dist/cli.js
MAIN_REPO="${MAIN_REPO:?}"

# --- chromium 自测（决定是否需要 --no-sandbox）+ 中文字体 ---
CHROME_EXTRA=""
if chromium --headless=new --disable-gpu --screenshot=/tmp/kp-chrome-test.png \
     http://127.0.0.1:7777/healthz >/dev/null 2>&1 && [[ -s /tmp/kp-chrome-test.png ]]; then
  log "chromium 无头自测通过（沙箱可用）"
else
  CHROME_EXTRA="--no-sandbox"
  if chromium --headless=new --disable-gpu $CHROME_EXTRA --screenshot=/tmp/kp-chrome-test.png \
       http://127.0.0.1:7777/healthz >/dev/null 2>&1 && [[ -s /tmp/kp-chrome-test.png ]]; then
    warn "chromium 需要 --no-sandbox 才能跑（已自动附加到 MCP 注册）"
  else
    warn "chromium 自测失败，chrome-devtools MCP 可能不可用（检查 shm_size/字体/依赖）"
  fi
fi
fc-list :lang=zh >/dev/null 2>&1 || warn "无中文字体，截图中文会变方框（镜像应含 fonts-noto-cjk）"
grep -q '1G\|1.0G' <(df -h /dev/shm | tail -1) || warn "/dev/shm 不是 1g（compose 覆盖未生效？）"

# --- 插件（幂等：列表里已有则跳过） ---
PLUGINS="$(claude plugin list 2>/dev/null || true)"
grep -q superpowers <<<"$PLUGINS" || {
  claude plugin marketplace add obra/superpowers-marketplace >/dev/null 2>&1 \
    || true   # 市场已添加时报错属预期
  claude plugin install superpowers@superpowers-marketplace
}
grep -q typescript-lsp <<<"$PLUGINS" || claude plugin install typescript-lsp@claude-plugins-official

# --- 通道 A：claude 用户级 MCP（人工会话用；remove 不存在时失败属预期） ---
crm() { claude mcp remove -s user "$1" >/dev/null 2>&1 || true; }
crm context7; claude mcp add -s user --transport http context7 https://mcp.context7.com/mcp
crm cf-docs;   claude mcp add -s user --transport http cf-docs https://docs.mcp.cloudflare.com/mcp
if [[ -n "${GITHUB_PAT:-}" ]]; then
  crm github; claude mcp add -s user --transport http github https://api.githubcopilot.com/mcp/ \
    --header "Authorization: Bearer $GITHUB_PAT"
else warn "未提供 GITHUB_PAT，跳过 github MCP"; fi
if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  crm vercel; claude mcp add -s user --transport http vercel https://mcp.vercel.com \
    --header "Authorization: Bearer $VERCEL_TOKEN"
else warn "未提供 VERCEL_TOKEN，跳过 vercel MCP"; fi
if [[ -n "${NEON_API_KEY:-}" ]]; then
  crm neon; claude mcp add -s user --transport http neon "https://mcp.neon.tech/mcp?apiKey=$NEON_API_KEY"
else warn "未提供 NEON_API_KEY，跳过 neon MCP"; fi
if [[ -n "${XCRAWL_KEY:-}" ]]; then
  crm xcrawl; claude mcp add -s user --transport http xcrawl "https://mcp.xcrawl.com/$XCRAWL_KEY/mcp"
else warn "未提供 XCRAWL_KEY，跳过 xcrawl MCP（其搜索功能已知损坏且扣费，搜索建议走脚本）"; fi
crm kunpeng-codegraph
claude mcp add -s user kunpeng-codegraph -- node "$CLI" codegraph serve --repo "$MAIN_REPO"
if grep -q seo-mcp "$CLI"; then
  crm kunpeng-seo
  claude mcp add -s user kunpeng-seo -- node "$CLI" seo-mcp serve --repo "$MAIN_REPO"
else warn "dist 不含 seo-mcp（镜像 <1.2.0），跳过 kunpeng-seo，需拉最新源码重建镜像"; fi
crm chrome-devtools
claude mcp add -s user chrome-devtools -- chrome-devtools-mcp --headless --isolated \
  --executable-path /usr/bin/chromium $CHROME_EXTRA
[[ -f /var/lib/kunpeng/bin/stitch-mcp-slim.mjs ]] && {
  crm stitch; claude mcp add -s user stitch -- node /var/lib/kunpeng/bin/stitch-mcp-slim.mjs; }
[[ -d /var/lib/kunpeng/strategy-docs ]] && {
  crm fs-docs; claude mcp add -s user fs-docs -- mcp-server-filesystem /var/lib/kunpeng/strategy-docs; }

# --- 通道 B：kunpeng MCP 注册表（loop 派出的 agent 用；--arg 值禁以 -- 开头） ---
krm() { $KP mcp remove "$1" >/dev/null 2>&1 || true; }
krm context7; $KP mcp add context7 --url https://mcp.context7.com/mcp
krm cf-docs;   $KP mcp add cf-docs --url https://docs.mcp.cloudflare.com/mcp
krm kunpeng-codegraph
$KP mcp add kunpeng-codegraph --command node \
  --arg "$CLI" --arg codegraph --arg serve --env "KUNPENG_REPO=$MAIN_REPO"
if grep -q seo-mcp "$CLI"; then
  krm kunpeng-seo
  $KP mcp add kunpeng-seo --command node \
    --arg "$CLI" --arg seo-mcp --arg serve --env "KUNPENG_REPO=$MAIN_REPO"
fi
krm chrome-devtools
$KP mcp add chrome-devtools --command sh --arg -c \
  --arg "exec chrome-devtools-mcp --headless --isolated --executable-path /usr/bin/chromium $CHROME_EXTRA"
if [[ -n "${GITHUB_PAT:-}" ]]; then
  krm github
  $KP mcp add github --url https://api.githubcopilot.com/mcp/ \
    --header 'Authorization=Bearer ${GITHUB_PAT}'   # 占位符：loop 运行时从容器 env 解析
fi
$KP mcp sync
log "kunpeng 注册表已 sync（生效条目见上）；per-profile mcp.json 下次派流惰性生成"

# --- 验证（真实连接，较慢属正常） ---
log "=== claude plugin list ==="; claude plugin list
log "=== claude mcp list（逐个真实连接，约 30-60s）==="; claude mcp list
log "=== kunpeng mcp list ==="; $KP mcp list
log "chromium 截图产物: $(ls -l /tmp/kp-chrome-test.png 2>/dev/null || echo 缺失)"
EOS

# ---------- 收尾：剩余人工步骤 ----------
cat <<EOF

==================== 剩余人工步骤（脚本无法代办） ====================
1. claude 登录（新账号必须）: docker compose ${COMPOSE_ARGS[*]} exec $SERVICE claude
   走 OAuth Device Flow，在本地浏览器完成授权；登录态落 $STATE_HOST/backend-auth/claude（重建不丢）
2. claude.ai 连接器（Claude Docs / Google Drive）: 新账号需在 claude.ai 网页
   Settings -> Connectors 重新连接，不随本脚本迁移
3. codex 登录（如未做）: docker compose ${COMPOSE_ARGS[*]} exec $SERVICE codex login
4. 验证 loop 通道: 在驾驶舱或 CLI 派一条最小流，确认 agent 能看到
   kunpeng-codegraph / context7 等 MCP（人工会话绿 ≠ loop 绿，两条通道独立）
5. 建议把本脚本与执行结果 capture 进知识库: kunpeng capture file deploy/scripts/setup-claude-code.sh
====================================================================
EOF
log "完成。云=$CLOUD 主项目=$MAIN_REPO 状态目录=$STATE_HOST"
