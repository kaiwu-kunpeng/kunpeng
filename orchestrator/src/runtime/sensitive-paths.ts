/** 敏感路径清单:触及鉴权、PII、账号、资金路径的 verified 流不许 autopilot 自动合并,必须走人工合并门。
 *  控制面与守门器源码也在清单里：改门的流必须过人工门（安全1）
 *  纯模块,不碰 git / fs。规则按 repo 相对路径匹配,统一 `(^|/)` 前缀,所以 META 根注册
 *  (orchestrator/src/server/auth.ts)与 orchestrator 子目录注册(src/server/auth.ts)都命中。
 *  以后要加路径只需在 SENSITIVE_PATH_RULES 追加一条。 */

export interface SensitivePathRule {
  /** 人话标签,进人工门文案与 autopilot 日志。 */
  label: string;
  /** 对 repo 相对路径(已归一为 `/` 分隔、去掉前导 `./`)做 test,一律大小写不敏感。 */
  pattern: RegExp;
}

export interface SensitiveHit {
  file: string;
  label: string;
}

export interface SensitiveClassification {
  sensitive: boolean;
  hits: SensitiveHit[];
}

/** 源码后缀:关键词规则只看源码文件,文档/图片里出现 secret 字样不算。 */
const SOURCE_EXT = "(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|sql)";

export const SENSITIVE_PATH_RULES: SensitivePathRule[] = [
  // 驾驶舱登录/鉴权/授权:auth.ts、authz.ts、auth-flow.ts、auth-context.ts、auth-change.ts…(不含 authors.ts 之类同前缀词)
  { label: "鉴权/授权", pattern: /(^|\/)src\/server\/auth(z|[-_.][^/]*)?\.ts$/i },
  // 人工门动作路由:合并/驳回/自动合并全走这里
  { label: "门动作路由", pattern: /(^|\/)src\/server\/routes\/gate-actions\.ts$/i },
  // 模型账号池与账号命令
  { label: "账号池", pattern: /(^|\/)src\/agent\/account-pool\.ts$/i },
  { label: "账号命令", pattern: /(^|\/)src\/cli-commands\/accounts\.ts$/i },
  // 安全模块整目录(含子目录)
  { label: "安全模块", pattern: /(^|\/)src\/security\//i },
  // 任何路径含 payment / billing / pii / secret / credential 的源码文件(目录名或文件名都算;pii 要求独立词,免得 apiinfo 误中;测试文件不算)
  {
    label: "资金/隐私/凭证关键词",
    pattern: new RegExp(
      `^(?!.*\\.(?:test|spec)\\.)(?=.*(?:payment|billing|secret|credential|(?:^|[^a-z0-9])pii(?![a-z0-9]))).*\\.${SOURCE_EXT}$`,
      "i",
    ),
  },
  // 两张账号表(驾驶舱登录用户 / 模型账号)
  { label: "驾驶舱登录用户表", pattern: /(^|\/)\.kunpeng\/auth\.json$/i },
  { label: "模型账号表", pattern: /(^|\/)\.kunpeng\/accounts\.json$/i },
  // 闸门控制面:三道闸开关 / 合并钩子 / 基线检查清单 / 对外面清单
  { label: "闸门控制面", pattern: /(^|\/)\.kunpeng\/(gates|hooks|checks|public-surface|flow-options)\.json$/i },
  // 运营门本体
  { label: "运营门文件", pattern: /(^|\/)\.kunpeng\/ops-gates\//i },
  // 技能资产:只认仓根 skills/ 与 .kunpeng/skills/ 两个写入根(src/skills/registry.ts 这类源码不算)
  { label: "技能资产", pattern: /^(?:skills\/|\.kunpeng\/skills\/)/i },
  // 宪法与角色卡
  { label: "宪法与角色卡", pattern: /^(?:constitution\/|roster\/)/i },
  // 守门器自己的源码,精确到文件名(merge-review.test.ts 之类不命中)。
  // 另含门禁入口(审计 S-04)：鉴权中间件、鉴权前路由(http)、bypass 拼装(chat-stream)、免鉴权 webhook、
  // WS 鉴权(pty-endpoint)、SSRF 闸、loop 门禁组装(dev-cycle)、派流控制(run-control)
  { label: "守门器源码", pattern: /(^|\/)src\/(?:runtime\/(?:sensitive-paths|merge-gate|merge-review|merge-tiers|merge-tier-evidence|merge-guard-tests|gate-mode|hooks)|loop\/(?:autopilot|autopilot-optout|scope-audit|public-surface|dev-cycle)|agent\/sandbox-(?:signal|wrap)|verify\/(?:scope-gate|scope-main-gate|gate|red-first)|server\/(?:authz|autopilot-guards|second-confirm|gate-diff|workspace-route|worker\/host-permissions|profile-middleware|http|chat-stream|webhook-endpoints|pty-endpoint|routes\/run-control)|util\/ssrf-guard|policy\/action-levels)\.ts$/i },
  // 门与审查规则源码：守门巡检、spec-lint、评测资产闸、敏感判定取数源。精确到文件名——
  // 同目录相似名（guardian-ui-helper.ts / spec-lint-format.ts）与 test/ 下同名测试不命中。
  {
    label: "门与审查规则源码",
    pattern: /(^|\/)src\/(?:loop\/guardian(?:-report)?|cli-commands\/maintain-guardian|plan\/spec-lint|spec\/spec-lint|verify\/eval-asset-guard|verify\/evaluator|runtime\/sensitive-branch)\.ts$/i,
  },
  // 审查规则与运营剧本：仓根 REVIEW.md（合并前审查规则正文）与 .kunpeng/playbooks/ 下任意剧本
  { label: "审查规则与运营 playbook", pattern: /(^|\/)(?:REVIEW\.md|\.kunpeng\/playbooks\/.+)$/i },
  { label: "部署与同步脚本", pattern: /^deploy\/scripts\//i },
  {
    label: "裁判组装与变异样本",
    pattern: /(^|\/)(?:src\/(?:loop\/audit\.ts|verify\/(?:diff-confirm\.ts|gate-mutation\.ts|gate-survivors\.json)|plan\/orchestrator\.ts|runtime\/harness-stamp\.ts)|test\/verify\/gate-mutation\.accept\.test\.ts|orchestrator\/(?:vitest\.config\.ts|tsconfig\.test\.json))$/i,
  },
  {
    label: "测试与类型检查输入",
    pattern: /(^|\/)(?:\.npmrc$|orchestrator\/(?:tsconfig[^/]*\.json$|vitest\.config\.[cm]?[jt]s$|test\/(?:.*\/)?(?:vitest-)?setup[^/]*\.ts$|test\/helpers\/)|src\/runtime\/sensitive-content\.ts$)/i,
  },
];

function normalizePath(file: string): string {
  return file.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "");
}

/** 对改动文件列表逐条过规则:每个 (文件, 规则) 命中一条 hit,文件去重、保序。纯函数不抛。 */
export function classifySensitiveFiles(files: readonly string[]): SensitiveClassification {
  const hits: SensitiveHit[] = [];
  const seen = new Set<string>();
  for (const raw of files) {
    const file = normalizePath(String(raw ?? ""));
    if (file === "" || seen.has(file)) continue;
    seen.add(file);
    for (const rule of SENSITIVE_PATH_RULES) {
      if (rule.pattern.test(file)) hits.push({ file, label: rule.label });
    }
  }
  return { sensitive: hits.length > 0, hits };
}

/** 去重后的标签串,进人工门文案与日志,如「鉴权/授权、账号池」。 */
export function summarizeSensitiveLabels(hits: readonly SensitiveHit[]): string {
  return [...new Set(hits.map((hit) => hit.label))].join("、");
}

/** 人工门文案前缀;flowstate 打标时拼进 humanGate.gate,autopilot 跳过理由也用它。 */
export const SENSITIVE_GATE_NOTE = "敏感路径改动需人工合并";
