# AWS EC2 部署(鲲鹏自托管)

一台 EC2 上常驻总控台:容器化鲲鹏(多项目注册表模式)+ Caddy 自动 HTTPS 公网入口,状态落在 EBS,重建容器不丢。本套件不改动仓库任何既有文件,全部在 `deploy/aws/` 内。

```text
Internet ──443──> Caddy(自动 TLS) ──> kunpeng 容器 :7777(仅 docker 网内可达)
                                        │  KUNPENG_STATE=/var/lib/kunpeng(EBS)
                                        │  项目仓挂载 /srv/repos → /workspace/repos
SSH(22,限管理 IP)──> ssh -L 7777 应急通道(实例宿主机回环)
```

| 文件 | 作用 |
| --- | --- |
| `user-data.sh` | EC2 user-data:装 Docker、建目录定属主 |
| `setup-instance.sh` | 实例内配置:生成 .env、构建镜像、起 compose、取首启密码 |
| `Dockerfile` | stock 镜像之上补 tmux(总控台持久终端依赖) |
| `docker-compose.aws.yml` | 多项目模式 kunpeng + Caddy,7777 不出公网 |
| `Caddyfile` | 自动 HTTPS 反代,WS/SSE 直通 |

成本参考(东京区按需):t4g.medium(arm64,2C4G)约 $24.5/月 + EBS 30GB gp3 约 $2.7/月 + 弹性 IP 约 $3.6/月;x86 用 t3.medium 约翻倍。鲲鹏本体是轻负载 Node 服务,重活由 AI 后端 API 承担,t4g.small(2GB)也够,留余量选 medium。

## 前提

- 一个域名,可加 A 记录(示例用 `kp.example.com`,全文替换为你的)
- EC2 key pair;本机装好 AWS CLI(`aws configure` 已配)
- `deploy/aws/` 套件需先推到 GitHub(main 合并是人工门;不推也可用文末「无 GitHub 通道」的 rsync 方式)

## 1. 起实例

```bash
cd ~/work/kunpeng/kunpeng
REGION=ap-northeast-1
KEY=<你的 key pair 名>
ARCH=arm64            # arm64→t4g.*,x86→amd64→t3.*
ITYPE=t4g.medium

# 最新 Ubuntu Server 24.04 LTS AMI(Canonical SSM 公共参数)
AMI=$(aws ssm get-parameter --region "$REGION" \
  --name "/aws/service/canonical/ubuntu/server/24.04/stable/current/${ARCH}/hvm/ebs-gp2/ami-id" \
  --query Parameter.Value --output text)

# 安全组:22 限管理 IP,80/443 对外(Caddy ACME 与访问)
SG_ID=$(aws ec2 create-security-group --region "$REGION" \
  --group-name kunpeng-cockpit-sg --description "kunpeng cockpit" \
  --query GroupId --output text)
MY_IP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
  --protocol tcp --port 22 --cidr "${MY_IP}/32"
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
  --protocol tcp --port 443 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
  --protocol tcp --port 443 --cidr ::/0

# 起机(注入 user-data;EBS 30G)
IID=$(aws ec2 run-instances --region "$REGION" \
  --image-id "$AMI" --instance-type "$ITYPE" \
  --key-name "$KEY" --security-group-ids "$SG_ID" \
  --user-data file://deploy/aws/user-data.sh \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3"}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=kunpeng-cockpit}]' \
  --query 'Instances[0].InstanceId' --output text)

# 弹性 IP(DNS 需要稳定入口)
EIP=$(aws ec2 allocate-address --region "$REGION" --query PublicIp --output text)
aws ec2 associate-address --region "$REGION" --instance-id "$IID" --public-ip "$EIP"
echo "实例 $IID ｜ IP $EIP"
```

## 2. DNS

到域名服务商把 `kp.example.com` 的 A 记录指向 `$EIP`。等生效(`dig +short kp.example.com`)。

## 3. 拿代码、起服务

首次 ssh 进实例(user-data 装机约 1–2 分钟):

```bash
ssh -i <key.pem> ubuntu@"$EIP"
# 仓库是公开的,HTTPS 直接拉(若走分支:git clone -b <分支> ...)
git clone https://github.com/kaiwu-kunpeng/kunpeng.git /opt/kunpeng-src
cd /opt/kunpeng-src
bash deploy/aws/setup-instance.sh   # 首跑生成 .env 模板后退出
```

编辑 `deploy/aws/.env`:填 `KUNPENG_DOMAIN=kp.example.com`;只登 Claude 时把 `KUNPENG_BACKEND` 改 `claude`,需要的话填 `CLAUDE_CODE_OAUTH_TOKEN`(见下)。再跑一次:

```bash
bash deploy/aws/setup-instance.sh   # 构建+启动;首启会打印 admin 随机密码,立即保存
```

## 4. 后端登录(run/plan 靠它执行,没登录只能看驾驶舱)

在实例 `/opt/kunpeng-src` 目录下:

```bash
# Codex:设备码登录,无浏览器也行
docker compose -f deploy/aws/docker-compose.aws.yml exec kunpeng codex login --device-auth
docker compose -f deploy/aws/docker-compose.aws.yml exec kunpeng codex login status

# Claude Code:长期令牌走环境变量
# ① 在有浏览器的本机执行 claude setup-token,复制令牌
# ② 实例上写进 deploy/aws/.env:CLAUDE_CODE_OAUTH_TOKEN=<令牌>
# ③ 重建容器加载环境:docker compose -f deploy/aws/docker-compose.aws.yml up -d
```

两个后端互为备份:一个失效时同次调用自动改用另一个(`KUNPENG_BACKEND` 未钉死时)。登录态在 `/var/lib/kunpeng/backend-auth/`,持久。

## 5. 登记项目仓

```bash
# 实例上把要管理的仓克隆到 /srv/repos/(私有仓需部署密钥或 PAT)
cd /srv/repos && git clone <repo-url> <名字>

# 登记进中央注册表(repoPath 用容器内路径 /workspace/repos/<名字>)
cd /opt/kunpeng-src
docker compose -f deploy/aws/docker-compose.aws.yml exec kunpeng \
  node dist/cli.js register --repo /workspace/repos/<名字> --name <项目名>

# 提交身份保险(flow 里的 git commit 需要;已有全局配置可跳过)
git -C /srv/repos/<名字> config user.name  <你的名字>
git -C /srv/repos/<名字> config user.email <你的邮箱>

# 查看已登记项目
docker compose -f deploy/aws/docker-compose.aws.yml exec kunpeng node dist/cli.js projects
```

flow 的 worktree 建在各仓 `.kunpeng/wt/` 内,随挂载持久;分支要推远端时给该仓配 GitHub 部署密钥(读写)。

## 6. 验证

```bash
# 实例上
curl -fsS http://127.0.0.1:7777/healthz
docker compose -f deploy/aws/docker-compose.aws.yml logs --tail=50 caddy   # 看 TLS 签发
# 本机
curl -fsSI https://kp.example.com/ | head -3
```

浏览器打开 `https://kp.example.com`,admin+首启密码登录后**立刻改密码**;再用无痕窗口确认未登录访问被拦。应急通道:`ssh -L 7777:127.0.0.1:7777 ubuntu@$EIP` 后本地 `http://127.0.0.1:7777`。

## 升级与回滚

```bash
cd /opt/kunpeng-src && git pull --ff-only
bash deploy/aws/setup-instance.sh   # 幂等:重建镜像、重启容器;/var/lib/kunpeng 不动
```

回滚 = `git checkout <旧提交>` 后重跑;状态目录始终独立于镜像。

## 备份

- EBS 快照:控制台/DLM 打 `vol-*(根卷)` 每日快照,保留 7 份
- 鲲鹏状态:`docker compose -f deploy/aws/docker-compose.aws.yml exec kunpeng node dist/cli.js snapshot`
- 备份与恢复详见 docs/runbooks/backup-restore.md

## 安全清单

- 7777 永不出公网(仅宿主机回环 + docker 网内),公网只经 Caddy 443
- 不设 `KUNPENG_ALLOW_INSECURE`;首启自动建 admin 并打印随机密码,登录鉴权强制生效
- SSH 安全组只放管理 IP;密码用强随机值,改密码后重启容器
- `deploy/aws/.env` 含令牌,已在 .gitignore 内,勿手工提交
- 后台周期任务(scout/maintain/patrol/ops/flywheel)在 Linux 上不能用 `--install`(依赖 launchd),用 cron/systemd timer 调 CLI 子命令,见 docs/help/03-admin-ops/platform-notes.md

## 无 GitHub 通道(备选)

`deploy/aws/` 未推 GitHub 时,从本机直接同步仓库到实例(含 .git,可后续 git pull):

```bash
rsync -av --exclude node_modules --exclude dist \
  ~/work/kunpeng/kunpeng/ ubuntu@"$EIP":/opt/kunpeng-src/
ssh ubuntu@"$EIP" 'cd /opt/kunpeng-src && bash deploy/aws/setup-instance.sh'
```
