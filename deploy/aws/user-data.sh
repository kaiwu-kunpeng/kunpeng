#!/bin/bash
# EC2 user-data:装机最小集(Docker、目录、属主)。仓库相关步骤见 setup-instance.sh。
# 幂等,可重复执行。
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git rsync

# Docker 官方源(自带较新的 compose 插件,支持 env_file required 语法)
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# ubuntu(uid 1000)免 sudo 用 docker;重登一次 ssh 生效
usermod -aG docker ubuntu

# 目录布局:
#   /opt/kunpeng-src  鲲鹏仓库(构建上下文)
#   /var/lib/kunpeng  KUNPENG_STATE(state/captures/后端登录态/账号密码)
#   /srv/repos        被管理的项目仓根(挂进容器 /workspace/repos)
install -d -o 1000 -g 1000 -m 0755 /opt/kunpeng-src /srv/repos
install -d -o 1000 -g 1000 -m 0700 /var/lib/kunpeng
install -d -o 1000 -g 1000 -m 0700 /var/lib/kunpeng/backend-auth/claude /var/lib/kunpeng/backend-auth/codex
