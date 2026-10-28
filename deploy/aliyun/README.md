# 阿里云 ECS 部署(鲲鹏自托管 · 国际站)

一台国际站 ECS 上常驻总控台:容器化鲲鹏(多项目注册表模式)+ Caddy 自动 HTTPS 公网入口,状态落在云盘,重建容器不丢。本套件不改动仓库任何既有文件,全部在 `deploy/aliyun/` 内;与 `deploy/aws/` 同构,差异仅实例侧(Docker 安装并入 setup-instance.sh,无需 user-data)。

```text
Internet ──443──> Caddy(自动 TLS) ──> kunpeng 容器 :7777(仅 docker 网内可达)
                                        │  KUNPENG_STATE=/var/lib/kunpeng(云盘)
                                        │  项目仓挂载 /srv/repos → /workspace/repos
SSH(22,限管理 IP)──> ssh -L 7777 应急通道(实例宿主机回环)
```

| 文件 | 作用 |
| --- | --- |
| `setup-instance.sh` | 实例内一站式配置:装 Docker(缺才装)、生成 .env、构建镜像、起 compose、取首启密码 |
| `Dockerfile` | stock 镜像之上补 tmux(总控台持久终端依赖) |
| `docker-compose.aliyun.yml` | 多项目模式 kunpeng + Caddy,7777 不出公网 |
| `Caddyfile` | 自动 HTTPS 反代,WS/SSE 直通 |

选型说明:国际站地域(如新加坡)无 ICP 备案要求,绑域名开 80/443 合规,Docker Hub/GitHub 直连可达;若改部署到中国大陆地域,须先完成 ICP 备案,并给 Docker 配镜像加速器,其余步骤不变。鲲鹏本体是轻负载 Node 服务,重活由 AI 后端 API 承担,2C4G(如 ecs.u1-c1m2.large / ecs.g8i.small)即有余量。

## 前提

- 已有国际站 ECS:Ubuntu 22.04/24.04(推荐),x86_64 或 arm64 均可;能 ssh 登录(root 或 sudo 用户)
- 一个域名,可加 A 记录(示例用 `kp.example.com`,全文替换为你的),解析到实例公网 IP
- 安全组放行(控制台 → ECS → 安全组 → 入方向):

| 端口 | 源 | 用途 |
| --- | --- | --- |
| 22 | 管理IP/32 | SSH(勿开 0.0.0.0/0) |
| 80 | 0.0.0.0/0 | Caddy ACME HTTP-01 与跳转 |
| 443 | 0.0.0.0/0 | HTTPS 入口 |

装有 aliyun CLI 的话也可命令行放行(`REGION`/`SG_ID` 替换为你的):

```bash
MY_IP=$(curl -s https://checkip.amazonaws.com)
aliyun ecs AuthorizeSecurityGroup --RegionId "$REGION" --SecurityGroupId "$SG_ID" \
  --IpProtocol tcp --PortRange 22/22 --SourceCidrIp "${MY_IP}/32" --NicType intranet
aliyun ecs AuthorizeSecurityGroup --RegionId "$REGION" --SecurityGroupId "$SG_ID" \
  --IpProtocol tcp --PortRange 80/80 --SourceCidrIp 0.0.0.0/0 --NicType intranet
aliyun ecs AuthorizeSecurityGroup --RegionId "$REGION" --SecurityGroupId "$SG_ID" \
  --IpProtocol tcp --PortRange 443/443 --SourceCidrIp 0.0.0.0/0 --NicType intranet
```

## 1. DNS

到域名服务商把 `kp.example.com` 的 A 记录指向实例公网 IP(ECS 绑 EIP 更稳,换实例不换 IP)。等生效(`dig +short kp.example.com`)。

## 2. 拿代码、起服务

**方式 A · 本机一键部署(推荐,SSH 通道)**——一条命令完成同步代码→配置→构建→启动→验证:

```bash
# 在本机鲲鹏仓库根目录;ssh 目标可以是 user@host 或 ~/.ssh/config 别名
bash deploy/aliyun/deploy.sh root@<EIP> kp.example.com        # 默认后端 codex
bash deploy/aliyun/deploy.sh -i <密钥.pem> root@<EIP> kp.example.com claude # 指定密钥 + Claude 后端
```

脚本幂等,可重复跑(升级=再跑一次);远端已填好的 `.env` 不会被覆盖(仅刷新域名/后端两项)。首启 admin 随机密码会打印在输出里,立即保存。

**方式 B · 手动步骤**——`deploy/aliyun/` 已推 GitHub 时(仓库公开,HTTPS 直拉):

```bash
ssh <user>@<EIP>
git clone https://github.com/kaiwu-kunpeng/kunpeng.git /opt/kunpeng-src
```

未推送时从本机 rsync(含 .git,后续可 git pull;首个 ssh 进实例后):

```bash
rsync -av --exclude node_modules --exclude dist \
  ~/work/kunpeng/kunpeng/ <user>@<EIP>:/opt/kunpeng-src/
```

然后实例内(裸机也行,Docker 缺失会自动装):

```bash
cd /opt/kunpeng-src
bash deploy/aliyun/setup-instance.sh   # 首跑:装 Docker(如缺)+ 生成 .env 模板后退出
```

编辑 `deploy/aliyun/.env`:填 `KUNPENG_DOMAIN=kp.example.com`;只登 Claude 时把 `KUNPENG_BACKEND` 改 `claude`,需要的话填 `CLAUDE_CODE_OAUTH_TOKEN`(见下)。再跑一次:

```bash
bash deploy/aliyun/setup-instance.sh   # 构建+启动;首启会打印 admin 随机密码,立即保存
```

## 3. 后端登录(run/plan 靠它执行,没登录只能看驾驶舱)

在实例 `/opt/kunpeng-src` 目录下:

```bash
# Codex:设备码登录,无浏览器也行
docker compose -f deploy/aliyun/docker-compose.aliyun.yml exec kunpeng codex login --device-auth
docker compose -f deploy/aliyun/docker-compose.aliyun.yml exec kunpeng codex login status

# Claude Code:长期令牌走环境变量
# ① 在有浏览器的本机执行 claude setup-token,复制令牌
# ② 实例上写进 deploy/aliyun/.env:CLAUDE_CODE_OAUTH_TOKEN=<令牌>
# ③ 重建容器加载环境:docker compose -f deploy/aliyun/docker-compose.aliyun.yml up -d
```

两个后端互为备份:一个失效时同次调用自动改用另一个(`KUNPENG_BACKEND` 未钉死时)。登录态在 `/var/lib/kunpeng/backend-auth/`,持久。

## 4. 登记项目仓

```bash
# 实例上把要管理的仓克隆到 /srv/repos/(私有仓需部署密钥或 PAT)
cd /srv/repos && git clone <repo-url> <名字>

# 登记进中央注册表(repoPath 用容器内路径 /workspace/repos/<名字>)
cd /opt/kunpeng-src
docker compose -f deploy/aliyun/docker-compose.aliyun.yml exec kunpeng \
  node dist/cli.js register --repo /workspace/repos/<名字> --name <项目名>

# 提交身份保险(flow 里的 git commit 需要;已有全局配置可跳过)
git -C /srv/repos/<名字> config user.name  <你的名字>
git -C /srv/repos/<名字> config user.email <你的邮箱>

# 查看已登记项目
docker compose -f deploy/aliyun/docker-compose.aliyun.yml exec kunpeng node dist/cli.js projects
```

flow 的 worktree 建在各仓 `.kunpeng/wt/` 内,随挂载持久;分支要推远端时给该仓配 GitHub 部署密钥(读写)。

## 5. 验证

```bash
# 实例上
curl -fsS http://127.0.0.1:7777/healthz
docker compose -f deploy/aliyun/docker-compose.aliyun.yml logs --tail=50 caddy   # 看 TLS 签发
# 本机
curl -fsSI https://kp.example.com/ | head -3
```

浏览器打开 `https://kp.example.com`,admin+首启密码登录后**立刻改密码**;再用无痕窗口确认未登录访问被拦。应急通道:`ssh -L 7777:127.0.0.1:7777 <user>@<EIP>` 后本地 `http://127.0.0.1:7777`。

## 升级与回滚

```bash
cd /opt/kunpeng-src && git pull --ff-only
bash deploy/aliyun/setup-instance.sh   # 幂等:重建镜像、重启容器;/var/lib/kunpeng 不动
```

回滚 = `git checkout <旧提交>` 后重跑;状态目录始终独立于镜像。

## 备份

- ECS 云盘快照:控制台/自动快照策略对系统盘(或数据盘)打每日快照,保留 7 份
- 鲲鹏状态:`docker compose -f deploy/aliyun/docker-compose.aliyun.yml exec kunpeng node dist/cli.js snapshot`
- 备份与恢复详见 docs/runbooks/backup-restore.md

## 安全清单

- 7777 永不出公网(仅宿主机回环 + docker 网内),公网只经 Caddy 443
- 不设 `KUNPENG_ALLOW_INSECURE`;首启自动建 admin 并打印随机密码,登录鉴权强制生效
- 安全组 22 只放管理 IP;密码用强随机值,改密码后重启容器
- `deploy/aliyun/.env` 含令牌,已在 .gitignore 内,勿手工提交
- 后台周期任务(scout/maintain/patrol/ops/flywheel)在 Linux 上不能用 `--install`(依赖 launchd),用 cron/systemd timer 调 CLI 子命令,见 docs/help/03-admin-ops/platform-notes.md
