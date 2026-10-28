import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { kunpengVersion } from "../../src/runtime/version.js";

// 1.2.0 条目定稿文本由 spec 作者锁定：CHANGELOG.md 里必须逐字出现这一整节。
const SECTION_1_2_0 = [
  "## [1.2.0] - 2026-09-28",
  "",
  "### Added",
  "- 决策收件箱：所有待人裁决的事项统一为一种结构并记录裁决人；提供批准 / 驳回 / 暂缓三键，硬门与软门分区显示并二次确认，按影响范围排序；支持每日配额、过期降级、缺席模式与按 owner 过滤。",
  "- 目标对象 `kunpeng goal`：每个仓库可登记目标，派流可带 `--goal` 归属，未归属的流单独成桶；周报把「进展与证据」和「下一步 KR 建议」拆成两次调用，人确认后才更新目标。",
  "- 动作分级表 L0–L4（单一来源 `policy/action-levels.ts`），收件箱与运营环都标注等级；L4 发布改为服务端两步确认，并拒收合成证据。",
  "- 实现 agent 可以主动求助（`RAISE_BLOCKER`），求助会出现在收件箱与 ACP `/status` 中，用 `/answer` 答复后流程续跑。",
  "- ACP 薄适配层 `kunpeng acp`：支持 ACP 的编辑器可以查看流状态、派发 spec、答复求助。",
  "- 合并前守门测试：守门测试变红时保留人工门，并记录「碰红」原因；合并后自动重建主干 dist 并跑冒烟。",
  "- 分级合并规则表放入受保护路径，判据由需求文本改为 diff 文件列表、守门测试结果和「先红后绿」证据。",
  "- 开发循环为每条流写本地 span 树（`.kunpeng/spans/<flowId>.jsonl`）；新增回滚归因分类与热图、每美元产出看板（`cost-report --by-harness`）、`escape-rate` 的「疑似逃逸」列。",
  "- 派流前的确定性检查：`kunpeng run` 派 spec 文件前先跑 spec-lint；新增「点名的测试不存在 / 锚点文件不存在 / 验收件语法错误 / vitest 没清后端变量」四类检查与回滚风险打分；同一类驳回或回滚原因出现 3 次以上会自动变成 spec-lint 规则。",
  "- 独立评估器：verify 阶段用与实现者不同的后端只读复核，结论为三值；判不定时挂人工门，可按项目开关。",
  "- 自进化提案需要带可证伪的预测，采纳满一个窗口后用流数据复核，预测没兑现就生成回滚提案草稿。",
  "- 技能固化前做确定性安全扫描；`skill pack` 按 Agent Skills 标准打包（只构建，不发布）；新增 `kunpeng spec-import`，可把 spec-kit / OpenSpec 转成鲲鹏 spec 骨架。",
  "- 本机会话采集（Beacon 模式）：`lessons harvest` 从 Claude Code / Codex 会话中提取纠错与调试模式，作为待验真的候选教训。",
  "- 执行后端抽象第一步：agent 进程可以配置为在本机 Docker 容器中运行。",
  "- 自建的五个 MCP server 同时兼容 MCP 2026-07-28 与旧版 initialize 握手。",
  "- 对话模型下拉新增 Opus 5.5（`claude-opus-5-5`）。",
  "- 入库技能 `skills/seo-audit`（SEO 与 AI 可见性诊断审计）。",
  "",
  "### Changed",
  "- 角色门改为显式能力表，默认拒绝；`read` 能力恢复为纯只读，反馈与收件箱的写操作分别改标 `dispatch` / `chat`。",
  "- 凭据改为默认拒绝的白名单：agent 子进程与验收命令只拿到白名单内的环境变量。",
  "- 取消 codex 沙箱豁免；每个工作区使用独立的 dist 与临时目录。",
  "- 判死机制分三级（租约 + 心跳），能给出归因并清理孤儿进程；流状态写入使用乐观版本号（CAS）。",
  "- 预算接入每条流；计价链修正；收据字段补齐并回填历史缺失。",
  "- 运营门等级取自运营 loop 的杠杆设置，不再写死 L2；「饿死」告警只在上游有活却一直喂不进来时才报。",
  "- 鲲鹏 HOME 收敛为单一来源（`util/kunpeng-home.ts`），对话不再回落到 `homedir()`。",
  "- 通用 helper（`escapeHtml` / `isNodeError` / `errorMessage` / `isRecord` / `readJsonBody`）收拢到单一来源，并加守门测试。",
  "- 源码文件体量增量闸：清单外的源文件不得超过 600 行。",
  "- 测试目录纳入类型检查（`tsconfig.test.json`），存量类型错误清零。",
  "- 运行时归档 `.kunpeng/state-archive` 不再由 git 跟踪（改为由本机备份覆盖）。",
  "- 每日 maintain 原地截断 `~/.kunpeng/logs` 下的大日志，保留 inode 不变。",
  "",
  "### Removed",
  "- 进化提案的机器自动批准通道：提案只能由人批准。",
  "- 5 个只被测试引用、已被取代的导出。",
  "",
  "### Fixed",
  "- 总览聚合只用第一个项目做底座，导致其它项目的门不显示。",
  "- 标记 rolled-back 失败时不再静默吞掉错误；4 处同步子进程补上超时。",
  "- ACP 读取 stdin 改为流式 UTF-8 解码，多字节字符跨块不再乱码。",
  "- `kunpeng run` 读不到 `.md` spec 时报错退出，相对路径先按 `--repo` 解析。",
  "- 工作台「出问题」栏不再显示 `[object Object]`。",
  "- 回归库隔离告警与状态目录非流文件告警各汇总成一行，不再逐条刷屏。",
  "- FlowTracker 写锁不再落到公共临时根目录（偶发失败的测试）。",
  "- Telegram 拒绝合并门时，清门失败不再被静默吞掉。",
  "",
  "### Security",
  "- 派流接口拒收非 owner 的自定义验收命令，验收命令的执行环境去掉宿主凭据；member 未设宿主权限上限时默认 isolated。",
  "- 写接口统一校验来源（防 CSRF）：鉴权后所有非 GET 的 `/api` 请求只接受同源。",
  "- 改密码后，此前签发的会话全部失效。",
  "- 知识库 URL 抓取与 copy-ref 逐跳经过 SSRF 闸，并加超时与响应体上限；SSRF 闸补齐保留地址段与 IPv6 内嵌 IPv4。",
  "- 自动合并敏感清单补上鉴权中间件、鉴权前路由、bypass 拼装、组装门禁与权限上限执行点等文件，改动这些文件必须停在人工门。",
  "- 工作区 say / events / gate 三个入口对 member 拒绝；通用批准路由按 artifact 类型拒收，堵住 L4 发布绕过二次确认。",
  "- prompt-shield 的「下载即执行」与「已知外传域名」两类硬拦补上行为测试，并补检 markdown 围栏、前缀写法、撇号与引用块等绕过写法。",
  "- publicSurface 闸在配置写坏时改为保守拦截。",
  "- `/healthz` 免登录只返回 `{ok}`，Dockerfile HEALTHCHECK 改为探测 `/healthz`。",
  "- 会话采集脱敏补上 JSON 键与连接串。",
].join("\n") + "\n";

const changelog = readFileSync(new URL("../../../CHANGELOG.md", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8")) as {
  version: string; packages: Record<string, { version?: string }>;
};

describe("1.2.0 发布卫生（作者锁定）", () => {
  test("CHANGELOG 逐字包含 1.2.0 一整节，位于 Unreleased 之后、1.1.0 之前", () => {
    expect(changelog).toContain(SECTION_1_2_0);
    const unrel = changelog.indexOf("## [Unreleased]");
    const v120 = changelog.indexOf("## [1.2.0] - 2026-09-28");
    const v110 = changelog.indexOf("## [1.1.0] - 2026-09-14");
    expect(unrel).toBeGreaterThanOrEqual(0);
    expect(v120).toBeGreaterThan(unrel);
    expect(v110).toBeGreaterThan(v120);
    expect(changelog.match(/^## \[1\.2\.0\]/gm)?.length).toBe(1);
  });

  test("旧版本节保持原样", () => {
    expect(changelog).toContain("## [1.0.0] - 2026-07-24");
    expect(changelog).toContain("## [0.1.0] - 2026-06-14");
    expect(changelog).toContain("- `kunpeng auth add-user <名> [--role owner|member] [--profile <id>]`");
  });

  test("版本号单一来源对齐到 1.2.0", () => {
    expect(pkg.version).toBe("1.2.0");
    expect(lock.version).toBe("1.2.0");
    expect(lock.packages[""]?.version).toBe("1.2.0");
    expect(kunpengVersion()).toBe("1.2.0");
  });
});