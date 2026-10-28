#!/bin/bash
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo "Usage: sync-mirror.sh <existing detached mirror directory>" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$1"
head=$(git rev-parse --verify HEAD)
if git symbolic-ref -q HEAD >/dev/null; then
  echo "Mirror must be a detached worktree" >&2
  exit 1
fi
if [[ -f "$script_dir/launchd-guard.sh" ]]; then
  KUNPENG_CLI="$PWD/orchestrator/dist/cli.js" bash "$script_dir/launchd-guard.sh" || true
fi
main=$(git rev-parse --verify refs/heads/main)
if [[ "$head" == "$main" ]]; then
  exit 0
fi

hold="${KUNPENG_CRON_HOLD:-$HOME/.kunpeng/cron-hold.json}"
if [[ -e "$hold" ]]; then
  echo "cron-hold: mirror sync paused by $hold"
  exit 0
fi

if ! git diff --quiet; then
  git diff --binary > "${KUNPENG_SYNC_PATCH:-/tmp/kp-sync-cron-last-discarded.patch}"
  git checkout -- .
fi
git checkout --detach main
if ! git diff --quiet "$head" HEAD -- orchestrator/package.json orchestrator/package-lock.json; then
  if [[ -L orchestrator/node_modules ]]; then
    echo "symlink: skipping dependency installation for orchestrator/node_modules"
  else
    (cd orchestrator && bash -c "${KUNPENG_SYNC_INSTALL_CMD:-npm install --no-audit --no-fund}")
  fi
fi
cd orchestrator
LOG="${KUNPENG_SYNC_LOG:-$HOME/.kunpeng/logs/kp-sync-cron.log}"
MARK_DIR="${KUNPENG_SYNC_MARK_DIR:-$HOME/.kunpeng/logs}"
mkdir -p "$(dirname "$LOG")" "$MARK_DIR" || echo "sync-mirror: cannot create log/mark directories" >&2
old_cli_available=false
if [[ -f dist/cli.js ]]; then
  old_cli_available=true
fi
if npm run build; then
  "${KUNPENG_NODE:-node}" dist/cli.js install-hooks || {
    message="镜像构建成功，但 install-hooks 失败，请检查绊线产物。"
    printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$message" >> "$LOG" || echo "$message" >&2
    mark="$MARK_DIR/.kp-shield-install-fail-alerted"
    last=0
    if [[ -e "$mark" ]]; then
      last=$(stat -c %Y "$mark" 2>/dev/null || stat -f %m "$mark" 2>/dev/null) || last=0
    fi
    if [[ ! -e "$mark" ]] || (( $(date +%s) - last >= 3600 )); then
      if "${KUNPENG_NODE:-node}" dist/cli.js send all "$message" --topic escalation --urgent; then
        touch "$mark" || echo "sync-mirror: cannot write ${mark}" >&2
      else
        printf '[%s] install-hooks 告警发送失败\n' "$(date -u +%FT%TZ)" >> "$LOG" || echo "sync-mirror: install-hooks alert failed" >&2
      fi
    fi
  }
else
  build_status=$?
  message="镜像 npm run build 失败，请检查构建日志。"
  printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$message" >> "$LOG" || echo "$message" >&2
  mark="$MARK_DIR/.kp-sync-cron-build-fail-alerted"
  last=0
  if [[ -e "$mark" ]]; then
    last=$(stat -c %Y "$mark" 2>/dev/null || stat -f %m "$mark" 2>/dev/null) || last=0
  fi
  if [[ "$old_cli_available" == true && -f dist/cli.js ]] && { [[ ! -e "$mark" ]] || (( $(date +%s) - last >= 3600 )); }; then
    if "${KUNPENG_NODE:-node}" dist/cli.js send all "$message" --topic escalation --urgent; then
      touch "$mark" || echo "sync-mirror: cannot write ${mark}" >&2
    else
      printf '[%s] 构建失败告警发送失败\n' "$(date -u +%FT%TZ)" >> "$LOG" || echo "sync-mirror: build alert failed" >&2
    fi
  fi
  exit "$build_status"
fi
exit 0
