# AWS 鲲鹏容器 · Claude 双中转沙箱接线手册（2026-11-03）

> 目标：鲲鹏容器内 spawn 的 Claude CLI 走第三方中转沙箱（qorz + ccmaxx 双账号），与宿主 OAuth 原环境彻底隔离；账号池按用量自动轮换。本文为真相源，同名 `.html` 供阅读。

## 0. 终态架构

| 组件 | 容器内路径 | 宿主路径 | 持久性 |
|---|---|---|---|
| 状态卷（KUNPENG_STATE 口径） | `/home/node/.kunpeng` | `/opt/kunpeng/lib` → `/data/kunpeng/lib`（symlink） | 持久 |
| 原环境（OAuth claude） | `/home/node/.claude`、`~/.claude.json` | `/opt/kunpeng/claude`、`/opt/kunpeng/claude-json/.claude.json` | 持久（bind mount，全程未动） |
| qorz 沙箱（旧 key sk-cc-3c52…） | `/home/node/.kunpeng/backend-auth/qorz-claude` | `/data/kunpeng/lib/backend-auth/qorz-claude` | 持久 |
| ccmaxx 沙箱（新 key sk-cc-1ecf…） | `/home/node/.kunpeng/backend-auth/ccmaxx-claude` | `/data/kunpeng/lib/backend-auth/ccmaxx-claude` | 持久 |
| 账号注册表 | `/home/node/.kunpeng/accounts.json` | `/data/kunpeng/lib/accounts.json` | 持久（靠 `KUNPENG_ACCOUNTS` 注入，见坑 ②） |
| 会话历史共享 | ccmaxx 沙箱 `projects` → `/home/node/.claude/projects`（软链） | — | 持久 |
| 宿主机器指纹 | `/home/node/.kunpeng/host-machine-id` | `/data/kunpeng/lib/host-machine-id`（拷自宿主 `/etc/machine-id`） | 持久 |

净化原则（相对中转服务官方装机模板的改造）：**无 alias 劫持**（不写任何 rc 文件）、**无 bypassPermissions**（保持默认询问模式）、**无 deny 削减**、机器指纹读宿主真身而非镜像层。启动方式 = 鲲鹏账号池（`kunpeng account add`），中转通道仅作为"claude 后端的一个账号"参与调度。

## 1. Canonical 启动命令（2026-11-03 起）

```bash
sudo docker run -d --name kunpeng --restart unless-stopped \
  --user node --shm-size 1g \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  -p 127.0.0.1:7777:7777 \
  -e KUNPENG_ACCOUNTS=/home/node/.kunpeng/accounts.json \
  -v /opt/kunpeng/repos:/workspace/repos \
  -v /opt/kunpeng/claude:/home/node/.claude \
  -v /opt/kunpeng/claude-json/.claude.json:/home/node/.claude.json \
  -v /opt/kunpeng/codex:/home/node/.codex \
  -v /opt/kunpeng/lib:/home/node/.kunpeng \
  kunpeng-aws:latest
```

与旧命令的两处差异：**删除 `-e KUNPENG_BACKEND=codex`**（恢复混合路由：spec/audit/review/verify→claude、implement→codex；此前 claude 沙箱接线因此被锁死）、**新增 `KUNPENG_ACCOUNTS`**（见坑 ②）。

## 2. 踩平的四个坑

**坑 ① cliVersion 精确字符串匹配**：中转 bootstrap 接口对 `payload.cliVersion` 做**全等比较**（`=== '2.1.310'`）。上报 `claude --version` 原始输出（`2.1.310 (Claude Code)`）会被拒，且报错文案原样回显版本、看着自相矛盾。解法：`split(' ')[0]` 取纯版本号。容器内 claude 必须为精确 2.1.310（`docker exec -u root kunpeng npm install -g @anthropic-ai/claude-code@2.1.310`）。

**坑 ② accounts.json 默认落镜像易失层**：`resolveKunpengHome()` 从模块位置回推仓根（容器内 `/opt/kunpeng`），账号注册默认写 `/opt/kunpeng/.kunpeng/accounts.json` = **容器可写层，重建即失**（实测：重建后账号池清空）。`KUNPENG_HOME` 不能改指状态卷（宪法/角色卡也从仓根读）。解法：`-e KUNPENG_ACCOUNTS=/home/node/.kunpeng/accounts.json`（CLI 写入与运行时 `loadAccounts` 都优先认它）。caveat：cockpit 配额面板（`dashboard.ts` 直读 `join(home,".kunpeng","accounts.json")`）不走此变量，面板可能显示不出配额，核心调度不受影响。

**坑 ③ 容器 machine-id 是镜像的**：`/etc/machine-id` 在容器内是镜像层烙的，同镜像共享、重建即变，中转的设备绑定会失效。解法：宿主 `cp /etc/machine-id /data/kunpeng/lib/host-machine-id`，bootstrap 优先读它（本次已做，`ec2a8a4d…`，跨重建稳定）。

**坑 ④ claude 2.1.310 装在易失层**：`npm install -g` 进容器可写层，**每次容器重建后须重装**（一条命令，见坑 ①）。治本（把版本烙进镜像）属鲲鹏仓库改动，留待后续走自建 loop。

## 3. 重建后 SOP（三步）

```bash
# ① 重装 claude 2.1.310（坑④）
sudo docker exec -u root kunpeng npm install -g @anthropic-ai/claude-code@2.1.310
# ② 核对账号池（应双账号预检 ✓，accounts.json 在状态卷不会丢）
sudo docker exec kunpeng kunpeng account list
# ③ healthz + 环境核对
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7777/healthz   # 200
sudo docker exec kunpeng sh -c 'env | grep KUNPENG_BACKEND || echo "OK 已解除"'
```

## 4. 沙箱通道日常使用

- 鲲鹏 loop 的 claude stage：自动走账号池，双账号按"本窗口用量最小者"轮换（均无上限则顺序轮转）。
- 手动进沙箱：`docker exec -e CLAUDE_CONFIG_DIR=/home/node/.kunpeng/backend-auth/ccmaxx-claude -it kunpeng claude`。
- 手动走原 OAuth：`docker exec -it kunpeng claude`（默认路径未被占用/未被劫持）。
- ccmaxx 沙箱的会话历史与原环境共享（projects 软链）；qorz 沙箱未共享，如需一致可补同样软链。
- 重新 bootstrap（换 key/换机器指纹后）：在容器内跑净化版 bootstrap 脚本（读 host-machine-id、cliVersion 取纯版本号、不带任何 bypassPermissions）。

## 5. 验证记录（2026-11-03 实测）

| 项 | 证据 |
|---|---|
| qorz 沙箱真机对话 | `claude -p "请只回复OK" → OK` |
| ccmaxx 沙箱真机对话 | 同上 → `OK`（新 key 设备绑定未被拒，同宿主双 key 可并存） |
| 双账号注册 | `account list`：qorz ✓ / ccmaxx ✓ 预检通过 |
| accounts.json 持久化 | 宿主 `/opt/kunpeng/lib/accounts.json`（338B，重建后存活） |
| KUNPENG_BACKEND 解除 | 重建后 `env | grep KUNPENG_BACKEND` 无输出 |
| 原环境完好 | `/opt/kunpeng/claude/.credentials.json` 等 mtime 全程未变（bootstrap 只写沙箱目录） |
| projects 软链 | `readlink → /home/node/.claude/projects`，重建后存活 |
| 服务自愈 | healthz 200（重建后第 2 次探测） |

## 6. 安全注意（无法净化的剩余风险）

- **鲲鹏 claude stage 的全部 prompt/代码将流经中转服务器**（qorz/ccmaxx，日志政策未知）——loop 中不要明文出现密钥/客户敏感数据。
- 沙箱保持默认询问模式（未设 bypassPermissions）是有意的：中转返回的内容不可视为可信指令源。
- 两把 key 已在多轮输出中出现过，建议在中转服务侧轮换。
