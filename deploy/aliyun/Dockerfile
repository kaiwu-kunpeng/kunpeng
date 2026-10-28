# 阿里云 ECS 部署镜像:在 stock 镜像之上补 tmux。
# 总控台持久终端依赖 tmux,见 docs/help/03-admin-ops/platform-notes.md。
# 构建顺序:先用根 Dockerfile 构建 kunpeng-orchestrator:local,再构建本层
# (setup-instance.sh 已保证顺序,勿单独构建本文件)。
ARG BASE=kunpeng-orchestrator:local
FROM ${BASE}

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends tmux \
    && rm -rf /var/lib/apt/lists/*
USER node
