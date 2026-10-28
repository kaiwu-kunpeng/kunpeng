#!/usr/bin/env bash
set -Eeuo pipefail

KUNPENG_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly KUNPENG_ROOT
readonly ORCHESTRATOR_DIR="${KUNPENG_ROOT}/orchestrator"

# run/plan 由 Claude Code 或 Codex CLI 执行；只用各自的状态命令判断登录态。
readonly BACKEND_CHECK_TIMEOUT=10

backend_install_hint() {
  case "$1" in
    claude) echo "npm install -g @anthropic-ai/claude-code" ;;
    codex) echo "npm install -g @openai/codex" ;;
  esac
}

backend_login_hint() {
  case "$1" in
    claude) echo "claude auth login（无浏览器的机器：在别处运行 claude setup-token，把令牌设为环境变量 CLAUDE_CODE_OAUTH_TOKEN）" ;;
    codex) echo "codex login（无浏览器的机器：codex login --device-auth）" ;;
  esac
}

# macOS / Debian 自带 perl；缺少 perl 时按约定退化为直接调用。
run_with_timeout() {
  local secs="$1"
  shift
  if command -v perl >/dev/null 2>&1; then
    perl -e 'alarm shift; exec @ARGV or exit 127' "${secs}" "$@"
  else
    "$@"
  fi
}

# 返回 0=已安装且已登录，1=未安装，2=未登录或状态检查失败/超时。
check_one_backend() {
  local name="$1"
  local rc=0
  if ! command -v "${name}" >/dev/null 2>&1; then
    return 1
  fi
  case "${name}" in
    claude) run_with_timeout "${BACKEND_CHECK_TIMEOUT}" claude auth status >/dev/null 2>&1 || rc=$? ;;
    codex) run_with_timeout "${BACKEND_CHECK_TIMEOUT}" codex login status >/dev/null 2>&1 || rc=$? ;;
  esac
  if (( rc == 0 )); then
    return 0
  fi
  return 2
}

check_backends() {
  local name
  local st
  local ready_count=0
  local pinned="${KUNPENG_BACKEND:-}"
  local pinned_ok=1
  echo "AI 后端检查（run/plan 至少需要一个已安装且已登录的后端）："
  for name in claude codex; do
    st=0
    check_one_backend "${name}" || st=$?
    case "${st}" in
      0)
        echo "  ✓ ${name}：已安装且已登录"
        ready_count=$((ready_count + 1))
        ;;
      1) echo "  ✗ ${name}：未安装 → $(backend_install_hint "${name}")" ;;
      *) echo "  ✗ ${name}：已安装但未登录（或状态检查失败/超过 ${BACKEND_CHECK_TIMEOUT} 秒）→ $(backend_login_hint "${name}")" ;;
    esac
    if [[ "${name}" == "${pinned}" && "${st}" != 0 ]]; then
      pinned_ok=0
    fi
  done
  if (( pinned_ok == 0 )); then
    echo "错误：KUNPENG_BACKEND=${pinned} 指定的后端不可用。按上面的提示修好它，或取消 KUNPENG_BACKEND。" >&2
    return 3
  fi
  if (( ready_count == 0 )); then
    echo "错误：没有可用的 AI 后端，run/plan 会失败。按上面的提示安装并登录任意一个。" >&2
    return 3
  fi
  return 0
}

if (( $# != 0 )); then
  if (( $# != 1 )) || [[ "$1" != "--check-backends" ]]; then
    echo "用法：./install.sh                  安装依赖、构建并检查 AI 后端" >&2
    echo "      ./install.sh --check-backends   只检查 AI 后端（不装不构建）" >&2
    exit 2
  fi
  backend_rc=0
  check_backends || backend_rc=$?
  exit "${backend_rc}"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 node。请先安装 Node.js 20 或更高版本。" >&2
  exit 1
fi

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [[ ! "${node_major}" =~ ^[0-9]+$ ]] || (( node_major < 20 )); then
  echo "错误：需要 Node.js >= 20，当前版本为 $(node --version)。" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "错误：未找到 npm。请安装带 npm 的 Node.js 发行版。" >&2
  exit 1
fi

missing_tools=()
for tool in python3 make; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    missing_tools+=("${tool}")
  fi
done
if ! command -v c++ >/dev/null 2>&1 && ! command -v g++ >/dev/null 2>&1; then
  missing_tools+=("c++/g++")
fi

if (( ${#missing_tools[@]} > 0 )); then
  echo "提示：node-pty 可能需要本地编译，当前未检测到：${missing_tools[*]}。" >&2
  echo "Debian/Ubuntu 可安装 build-essential python3；macOS 可安装 Xcode Command Line Tools。" >&2
fi

cd "${ORCHESTRATOR_DIR}"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

echo
backend_rc=0
check_backends || backend_rc=$?
if (( backend_rc != 0 )); then
  echo "构建已完成，但 AI 后端没有就绪。修好后运行 ./install.sh --check-backends 复查。" >&2
  exit "${backend_rc}"
fi

cat <<EOF

鲲鹏已安装并完成 build。

下一步（请把目标仓路径替换成真实绝对路径）：
  cd "${ORCHESTRATOR_DIR}"
  node dist/cli.js serve 7777 --repo /absolute/path/to/target-repo

然后访问 http://127.0.0.1:7777/
生产常驻方式见 docs/runbooks/install.md。
EOF
