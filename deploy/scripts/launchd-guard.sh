#!/bin/bash

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if [[ "$(uname)" != Darwin && "${KUNPENG_GUARD_FORCE:-}" != 1 ]]; then
  exit 0
fi

AGENTS_DIR="${KUNPENG_LAUNCHAGENTS_DIR:-$HOME/Library/LaunchAgents}"
LOG="${KUNPENG_SYNC_LOG:-$HOME/.kunpeng/logs/kp-sync-cron.log}"
MARK_DIR="${KUNPENG_SYNC_MARK_DIR:-$HOME/.kunpeng/logs}"
CLI="${KUNPENG_CLI:-}"
UID_="${KUNPENG_UID:-$(id -u)}"
LAUNCHCTL="${KUNPENG_LAUNCHCTL:-launchctl}"
NODE="${KUNPENG_NODE:-node}"
mkdir -p "$(dirname "$LOG")" "$MARK_DIR"

missing=()
for p in "$AGENTS_DIR"/com.kunpeng.*.plist; do
  [ -e "$p" ] || continue
  label="${p##*/}"
  label="${label%.plist}"
  if "$LAUNCHCTL" print-disabled "gui/${UID_}" 2>/dev/null | grep -Fq "\"${label}\" => disabled"; then
    continue
  fi
  if ! details=$("$LAUNCHCTL" print "gui/${UID_}/${label}" 2>/dev/null); then
    "$LAUNCHCTL" enable "gui/${UID_}/${label}"
    if "$LAUNCHCTL" bootstrap "gui/${UID_}" "$p"; then
      printf '[%s] launchd 补挂：%s\n' "$(date -u +%FT%TZ)" "$label" >> "$LOG"
    else
      printf '[%s] launchd 补挂失败：%s\n' "$(date -u +%FT%TZ)" "$label" >> "$LOG"
    fi
    # 补挂后重新读取，刚恢复的任务也要检查 LWCR。
    if ! details=$("$LAUNCHCTL" print "gui/${UID_}/${label}" 2>/dev/null); then
      continue
    fi
  fi
  if ! printf '%s\n' "$details" | grep -iq LWCR; then
    missing+=("$label")
  fi
done

mark="$MARK_DIR/.kp-lwcr-reminded"
if [[ ${#missing[@]} -eq 0 ]]; then
  rm -f "$mark"
else
  now=$(date +%s)
  last=0
  if [[ -e "$mark" ]]; then
    last=$(stat -c %Y "$mark" 2>/dev/null || stat -f %m "$mark" 2>/dev/null)
  fi
  if [[ ! -e "$mark" ]] || (( now - ${last:-0} > 86400 )); then
    message="launchd 任务缺少 LWCR：${missing[*]}。请检查配置。"
    printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$message" >> "$LOG"
    if [[ -n "$CLI" ]] && "$NODE" "$CLI" send all "$message" --topic escalation; then
      touch "$mark"
    fi
  fi
fi

exit 0
