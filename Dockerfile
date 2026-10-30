FROM node:22-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/kunpeng/orchestrator
COPY orchestrator/ ./

RUN npm ci
RUN npm run build

# run/plan 所需后端；登录见 docs/runbooks/install.md「容器内的 AI 后端登录」。
RUN npm install -g @anthropic-ai/claude-code @openai/codex

# 容器内终端/总控台直接敲 kunpeng(只 npm run build 未链接 package.json 的 bin 字段)
RUN printf '#!/bin/sh\nexec node /opt/kunpeng/orchestrator/dist/cli.js "$@"\n' \
      > /usr/local/bin/kunpeng \
    && chmod 755 /usr/local/bin/kunpeng

RUN chown -R node:node /opt/kunpeng
USER node

EXPOSE 7777

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:7777/healthz', (response) => { response.resume(); process.exit(response.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve", "7777", "--host", "0.0.0.0"]
