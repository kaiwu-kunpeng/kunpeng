# Sub2API ECS 部署操作手册（号池服务）

> 目标：在阿里云 ECS（47.85.82.7）部署 [Sub2API](https://github.com/Wei-Shaw/sub2api)，把多个 Claude Max 订阅账号池化为 OpenAI/Anthropic 兼容 API（`base_url + api_key`），供 kaiwu / Dify / 自研程序调用。
> 决策记录：管理后台走 SSH 隧道（公网零暴露）；鲲鹏 CLI 直连不经 sub2api；代理出口先裸跑观察。

## 0. 风险声明（部署前必读）

- **上游 ToS 风险**：号池化订阅额度可能违反 Anthropic/OpenAI 服务条款，封号风险自负（项目 README 官方明示）。
- **IP 关联风险**：多号共享一个 IDC 出口 IP 是风控敏感点；稳态运营建议每个号配独立住宅代理出口。当前策略：先裸跑观察，出向流量走 ECS 公网 IP（47.85.82.7）。
- 项目定位为技术学习研究，勿商用。

## 1. 架构与落位

```text
Max 号 1..N ──OAuth──> sub2api 容器(127.0.0.1:8180) ──发 key──> kaiwu/Dify/业务程序
                        ├── PostgreSQL 15  (渠道/用户/日志)
                        └── Redis 7        (会话/限流)
代码/配置: /opt/sub2api/    (docker-compose.yml + .env,600)
数据:      /data/sub2api/   (data/ postgres_data/ redis_data/,落数据盘)
管理入口:  ssh -L 8180 隧道 → 本地浏览器 http://127.0.0.1:8180
```

| 项 | 值 | 说明 |
| --- | --- | --- |
| 端口 | `127.0.0.1:8180` → 容器 8080 | 宿主 8080/8081 已被旧 kaiwu-portal 占用，必须换 |
| 数据盘 | `/data/sub2api/` | 49G 数据盘，当前余 46G |
| 安全组 | **无需改动** | 8180 仅回环，公网零暴露 |
| 与鲲鹏关系 | 无耦合 | 鲲鹏走 CLI 直连（codex/claude OAuth），不经 sub2api |

## 2. 部署步骤

### 2.1 准备目录

```bash
mkdir -p /opt/sub2api /data/sub2api && cd /opt/sub2api
```

### 2.2 官方一键准备（生成 compose + 密钥）

```bash
curl -sSL https://raw.githubusercontent.com/Wei-Shaw/sub2api/main/deploy/docker-deploy.sh | bash
```

脚本会：下载 `docker-compose.local.yml` 存为 `docker-compose.yml`、从 `.env.example` 生成 `.env`（自动写入随机 `JWT_SECRET` / `TOTP_ENCRYPTION_KEY` / `POSTGRES_PASSWORD` / `ADMIN_EMAIL`，权限 600）、创建 `data/ postgres_data/ redis_data/` 三个目录。

**立即记录**（脚本输出里也有）：

```bash
grep -E "ADMIN_EMAIL" .env        # 管理员登录名(admin-xxxx@sub2api.local)
```

> 仅重复执行时脚本才有覆盖确认交互；首次执行无交互。

### 2.3 本地化调整（三处，避坑核心）

```bash
cd /opt/sub2api

# ① 端口:8080 被 kaiwu-portal 占用 → 改绑回环 8180(公网零暴露)
#    编辑 docker-compose.yml,找到 sub2api 服务的 ports,把 "8080:8080" 改为:
#      - "127.0.0.1:8180:8080"

# ② 数据目录:默认 ./data 等相对路径 → 改落数据盘
#    编辑 docker-compose.yml,把三个 volume 源路径改到 /data/sub2api/:
#      ./data          → /data/sub2api/data
#      ./postgres_data → /data/sub2api/postgres_data
#      ./redis_data    → /data/sub2api/redis_data
#    (先 grep 确认 compose 里的实际写法)
grep -n -E "data|postgres|redis" docker-compose.yml

# ③ 数据盘目录建好并授权(容器内进程按 compose 的 user 运行,通常 root 可写)
mkdir -p /data/sub2api/{data,postgres_data,redis_data}
```

### 2.4 启动

```bash
cd /opt/sub2api && docker compose up -d
docker compose ps                      # 三个服务(sub2api/postgres/redis)应 Up
```

### 2.5 取首启管理员密码

```bash
docker compose logs sub2api 2>&1 | grep -i -A2 "password"   # 首启自动生成,立即保存
```

## 3. 管理后台访问（SSH 隧道）

本地 Mac 执行：

```bash
ssh -i /Users/xiehuaqiao/Desktop/aliyun/_xxwl-kunpeng.pem -L 8180:127.0.0.1:8180 root@47.85.82.7
# 保持连接,本地浏览器打开:  http://127.0.0.1:8180
```

登录：`ADMIN_EMAIL`（.env 里）+ 首启密码。**登录后立即改密并开启 TOTP 两步验证**。

## 4. 号池配置（Web 后台操作）

1. **添加渠道**：渠道/Channel → 新建 → 选 Claude（Max Plan 订阅类型）
2. **账号入池**：在渠道下添加账号，走 OAuth 授权——后台生成授权链接，本地浏览器打开、登录对应的 Max 账号并授权；每个号重复一次
3. **建用户/分组**：按下游业务建用户（如 `kaiwu`、`dify`），归入分组
4. **生成 API key**：给每个用户生成独立 key（额度/限流可按用户控制）

> 后台菜单名称以实际版本界面为准；渠道 → 账号(OAuth) → 用户/key 三级结构不变。

## 5. 下游调用

同机容器/宿主：

```bash
curl http://127.0.0.1:8180/v1/chat/completions \
  -H "Authorization: Bearer <sub2api生成的key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-5","messages":[{"role":"user","content":"ping"}]}'
```

- OpenAI 兼容：`/v1/chat/completions`；Anthropic 兼容：`/v1/messages`（按客户端选）
- 模型名以渠道配置为准
- 跨机器调用（如需要）：后续经宿主 Caddy 加子域名反代 + 鉴权，当前不开

## 6. 代理出口位（预留，暂不启用）

- **整容器出向**：compose 给 sub2api 服务加 `environment: HTTPS_PROXY=...`（全部号共用一个出口）
- **每号独立出口**：查后台渠道/账号级代理设置（以实际版本功能为准）；生态常规做法是住宅代理一号一 IP
- 当前裸跑；若某号被风控/吊销，再按号配代理

## 7. 备份 / 升级 / 回滚

```bash
# 备份(数据盘整体已有 ECS 云盘快照策略,这里补应用级)
tar -czf /data/backups/sub2api-$(date +%F).tar.gz -C /data sub2api -C /opt sub2api/.env

# 升级
cd /opt/sub2api && docker compose pull && docker compose up -d

# 回滚:数据卷(/data/sub2api)与镜像解耦,重跑旧版 compose 即可;升级前先打快照
```

## 8. 安全清单

- 8180 仅回环绑定，公网零暴露，安全组无需放行新端口
- `.env`（600）含 DB 密码与 JWT 密钥，勿提交、勿外传
- 管理后台必开 TOTP；API key 泄漏 = 额度泄漏，定期轮换
- 与鲲鹏（/data/kunpeng）、kaiwu（/data/kaiwu-cli）目录严格隔离，互不触碰

## 9. 维护命令速查

```bash
cd /opt/sub2api
docker compose ps                       # 状态
docker compose logs -f sub2api          # 跟日志
docker compose restart sub2api          # 重启网关(不动 DB)
docker compose down                     # 停(数据在 /data/sub2api 不丢)
df -h /data                             # 数据盘余量
```
