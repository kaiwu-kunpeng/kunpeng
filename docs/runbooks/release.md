# 商业交付发布手册

商业交付必须从已审核的目标提交执行，任何一步失败都应停止发布并修复问题。

1. 在 `orchestrator/` 目录运行 `npm run verify`，确认 lint、类型检查与测试全部通过。
2. 回到仓库根目录运行 `scripts/make-delivery.sh`。需要指定输出目录时，将目录作为第一个参数传入，例如 `scripts/make-delivery.sh /tmp/kunpeng-release`。
3. 核对脚本输出的包路径、大小和 SHA-256；使用同目录的 `.sha256` 文件再次验证交付包校验和。
4. 解压 `kunpeng-<version>.tar.gz` 后会得到唯一的顶层目录 `kunpeng-<version>/`；进入该目录再执行后续构建，例如 `tar -xzf kunpeng-<version>.tar.gz && cd kunpeng-<version>/`。
5. 仅使用解压后 `kunpeng-<version>/` 中的内容构建候选镜像，并完成端到端验收：首次启动、创建账号、登录，以及访问总控台确认 HTTP 200。
6. 端到端验收通过后，上传交付包及其 `.sha256` 校验文件。

租户闸豁免 `orchestrator/test/detenant/`，因为护栏测试必须包含禁用词字面量；新增去租户化护栏一律放在该目录下。

**禁止手工 tar 打包绕过该脚本。**

## 排除清单与中性化（2026-09-14）

排除清单新增内部审计、报告、研究、交接、运维笔记、提案等目录，同时排除 `scripts/`、`.tmp-shots/` 与 `orchestrator/.kunpeng/`。
两篇隧道部署笔记 `docs/runbooks/cockpit-remote-access.md`、`docs/runbooks/aeohq-cloudflare-tunnel.md`，以及五个仅对开发仓成立的测试也从交付包中排除。
出包时先使用 `perl -pi` 对导出内容中的文本文件做中性化，将开发者账号、本机路径和两个兄弟子域替换为通用示例。
中性化完成后依次运行个人标识、手机号、凭据形状、凭据文件四道额外硬闸，再运行租户闸，任一闸命中即停止出包。
