# 鲲鹏自建 Spec 标准模板（SPEC-TEMPLATE）

> 供所有人 / agent 写 `kunpeng plan` 自建 spec 时**照抄**。
> 本模板与真实解析器逐条对齐（`plan/parse.ts` · `plan/acceptance.ts` · `verify/scope-gate.ts` · `loop/dev-cycle.ts` · `loop/audit.ts` · `plan/spec-lint.ts`），每条规则都是踩坑后机器强制的，不是风格偏好。
> `kunpeng plan` 入口已内置 spec-lint 硬门：**有 error 直接 exit 2 不发射**。写完先跑 `kunpeng spec-lint <spec.md> --strict`。

---

## 一、模板骨架（单段单流，最常用——直接复制改内容）

````markdown
# 一句话标题：给 X 模块加 Y 能力

**目标**
- 一两条可观察的结果（做完后系统多了什么行为）。

**实现要求**
- 新建 `orchestrator/src/<模块>/<新文件>.ts`，导出 `newSymbol(...)`，行为：…（钉死路径与命名，agent 爱放错目录/改名）。
- 修改 `orchestrator/src/<模块>/<既有文件>.ts`：…（写清改哪个函数、怎么改）。
- 分节说明用 **粗体行**，不要用 `##`/`###` 子标题（子标题会被拆成无验收的多 flow，整段回滚）。

**约束**
- 不改 `orchestrator/src/loop/**` 等无关区域；不删非范围文件。
- 破坏性 API 改动必须连消费者一起在本 spec 内修完（每 flow 都跑全量 typecheck）。

**验收标准**
- 客观可判定的条目，与下方 accept 命令一一对应。

```scope
allow: orchestrator/src/<模块>/<新文件>.ts
allow: orchestrator/src/<模块>/<既有文件>.ts
allow: orchestrator/test/<模块>/<新文件>.test.ts
forbid: orchestrator/src/loop/**
```

```accept-file path=orchestrator/test/<模块>/<新文件>.test.ts
import { describe, it, expect } from "vitest";
import { newSymbol } from "../../src/<模块>/<新文件>.js";

describe("newSymbol", () => {
  it("具体输入 → 具体输出（作者给死用例，实现者绕不过）", () => {
    expect(newSymbol("输入")).toBe("期望输出");
  });
});
```

```accept
cd orchestrator && test -f test/<模块>/<新文件>.test.ts && grep -q newSymbol src/<模块>/<新文件>.ts && npx --no-install tsc --noEmit && npx --no-install vitest run <新文件>.test
```
````

**多段并行**才用多个 `# 段X：…` 的 H1，每段各带自己的 scope / accept-file / accept，段与段之间不得有编译/类型依赖（并行分支互相看不见；有依赖就并进同一段，或拆成串行的两个 plan）。

---

## 二、逐块填写指南（每条都注明是哪段代码强制的）

**1. 标题：全文只有一个 H1，段内绝不出现 `##`/`###`**
`parseMethodPlan`（plan/parse.ts）按标题层拆段拆流：单 H1 当文档标题；≥2 个 H1 各自成段；段内更深一层标题 / `- [ ]` checklist 每个拆成独立 flow。被拆散的 flow 没有自己的 accept → 默认跑 `npm run build`，在仓根（无 package.json）必失败整段回滚。分节一律用**粗体行**；普通 `-` 列表安全，`- [ ]` checklist 会拆流，别顺手打勾框。
（例外：``` 围栏**内部**的标题行是安全的，parse.ts 会跳过；但 `<file>` XML 块内的标题**不安全**，见反例 9。）

**2. `scope` 块：每行一条 `allow: <glob>` 或 `forbid: <glob>`，冒号后必须有空格**
`parseScopeDeclaration`（verify/scope-gate.ts）逐行正则取值；spec-lint 更严格（`scope-line-invalid`）。**YAML 列表写法会静默解析成空 = 范围门完全不拦**（现已被 lint 拦下）。多个 scope 块会全部聚合取并集，可以分散写，但每行格式不变。
scope 要圈进：本 flow 新建/修改的全部文件 + 破坏性改动波及的消费者文件 + **引用被改符号的既有测试文件**（否则差分门抓到基线外新错、实现者又无权改，必回滚）。拿不准 agent 会把文件放哪 → 用 `<dir>/**`。

**3. `accept-file path=…` 块：作者亲写的验收测试，机器锁定**
`extractAuthorFilesFromSpec`（loop/dev-cycle.ts）认**恰好三个反引号**、info 行带 `path=`/`file=`/`filename=` 属性的围栏（` ```accept-file path=… ` 与 ` ```ts path=… ` 等价），在**每次 verify 前**把内容覆盖落盘到 worktree——实现者改写/删除都会被还原，只能去满足它。
- 路径相对 worktree 根（即 git 根，如 `orchestrator/test/...`）。
- import 必须指向**真实现文件**且**带 `.js` 后缀**（ESM；漏了 tsc/vitest 都绿但运行时炸）。
- 用例给死具体输入输出，别写恒真断言（audit 会判弱测试整盘中止）。
- 内容需含 `expect(` 或 `test -f`（lint `accept-file-weak` 告警）。
- **四个反引号的围栏不被识别**，不会锁定（反例 8）。

**4. `accept` 块：验收命令，必须硬断言新产物存在**
`extractAcceptance`（plan/acceptance.ts）只认 ` ```accept ` 围栏（**必须有收尾 ```**）或行首 `验收:`/`Acceptance:`。`TESTCMD:` 行在 plan spec 里**不解析**、纯注释（老 reference spec 用它是误导，别照抄）。
命令模式（用 /bin/bash 跑，避免复杂内嵌 `node -e`，会被解析管线打碎）：
`test -f <新测试文件>`（测试真落盘）`&& grep -q <新符号> <被改源文件>`（源码真改）`&& npx --no-install tsc --noEmit && npx --no-install vitest run <只匹配新测试的 token>`。
为什么必须 `test -f` + `grep -q` 前置：`vitest run <token>` 是文件名子串过滤，token 匹配不到不报错、匹配到已有测试照样绿——空 commit 也能假 verified。token 务必只命中新测试文件、别撞已有测试名。
（audit.ts 的 `missingTestFiles` 现会在实现前硬毙"vitest 点名的测试文件既不在磁盘也没被作者锁定"的 flow，但 accept 自身硬断言仍是铁律——它还防空实现。）

**5. 命名：避开与现有模块的语义重叠**
spec 里的新符号/文件名若与既有模块撞语义（如 `meta-learn` ↔ knowledge/learn），实现 agent 的检索会被锚去改旧模块、真功能永不实现却连环假绿。起名前先 grep 一把。

**6. 破坏性 API 改动：改动方和全部消费者必须同一个 flow**
DevCycle 对每个 flow 都跑全量差分 typecheck（不受 accept 控制）。把"改 API"和"修消费者"拆两个 flow 必失败。纯新增模块才可拆并行段。

---

## 三、发射前自检（两个都过再 `kunpeng plan`）

```bash
# 1. 结构 lint（plan 入口同款硬门，--strict 连告警一起拦）
kunpeng spec-lint <spec.md> --strict

# 2. 真解析器干跑：确认段/流数符合预期、每 flow accept ✔、scope 非空、作者文件提取到
#（DIST 指向新鲜构建的 orchestrator/dist 绝对路径，如 /Users/dev/kunpeng-serve/orchestrator/dist）
DIST=<orchestrator/dist 绝对路径> node --input-type=module -e '
const { parseMethodPlan } = await import(process.env.DIST + "/plan/parse.js");
const { parseScopeDeclaration } = await import(process.env.DIST + "/verify/scope-gate.js");
const { extractAuthorFilesFromSpec } = await import(process.env.DIST + "/loop/dev-cycle.js");
import { readFileSync } from "fs";
const md = readFileSync(process.argv[1], "utf8");
const plan = parseMethodPlan(md);
for (const p of plan.phases) for (const f of p.flows) console.log("flow:", p.title, "/", f.title, "accept:", f.acceptanceCmd ? "✔" : "✘");
console.log("scope:", JSON.stringify(parseScopeDeclaration(md)));
console.log("author files:", extractAuthorFilesFromSpec(md).map(f => f.path));
' <spec.md 绝对路径>
```

注意 dist 新鲜度：改过 orchestrator src 后必 `npm run build`，别拿陈旧 dist 自检/当 runner。

---

## 四、反例清单（症状 → 真因对照；报错都有迷惑性，先查这张表）

| # | 错误写法 | 症状（具迷惑性） | 真因与正确写法 |
|---|---|---|---|
| 1 | scope 写成 YAML 列表（`allow:` 换行 `- path`） | 以前：门不拦、agent 越界合入；现在：lint 报 `scope-line-invalid`/`scope-empty` | 每行一条 `allow: <glob>`，冒号后一个空格，glob 同一行 |
| 2 | 漏写 scope 块 | 以前：范围门整个跳过；现在：lint 报 `scope-missing` 拒发射 | 必带 scope；拿不准就 `<dir>/**` |
| 3 | ` ```accept ` 漏收尾 ``` | 报「vitest 命令点名的测试文件不存在」整盘中止，像是路径写错 | fence 没闭合 → accept 解析失败 → 走 LLM 翻译路径撞审计。lint 报 `fence-unterminated`。补收尾 ``` |
| 4 | 作者测试用裸 ` ```ts `（无 `path=`） | accept 的 `test -f` 失败且 **reason 显示为空**，像门坏了 | 框架只锁 info 行带 `path=` 的围栏，裸块不落盘。写 ` ```ts path=…` 或 ` ```accept-file path=…` |
| 5 | accept 只写 `vitest run <token>` | flow verified 全绿，实际空 commit / 测试没落盘 | vitest token 是子串过滤，命中已有测试即绿。前置 `test -f` + `grep -q 新符号` |
| 6 | 段内用 `##`/`###` 分节或 `- [ ]` checklist | 部分 flow 报「Missing script: build」整段回滚 | 被拆成无 accept 的多 flow。用粗体行分节、普通 `-` 列表 |
| 7 | `TESTCMD:` 行当验收 | 验收像没生效，被 LLM 重新翻译 | plan spec 不解析 TESTCMD，只认 ` ```accept ` 围栏 / `验收:` 行 |
| 8 | 作者文件用四反引号围栏 | 同反例 4（不落盘、reason 空） | 锁定正则只认**恰好三个**反引号 |
| 9 | `<file path=…>` 块内含 `# `/`## ` 标题行 | 报「vitest 点名的测试文件不存在」整盘中止 | `<file>` 不是围栏，块内标题把 spec 拆流、accept 与测试被拆散。块内标题改粗体行（``` 围栏内的标题则安全） |
| 10 | 改 API 签名但消费者拆在另一 flow / 消费者测试不在 scope | typecheck 差分报基线外新错 / outside-allow，必回滚 | API+全部消费者同 flow；先全仓 grep 引用，把消费者及其既有测试文件圈进 scope |
| 11 | 作者测试 import 漏 `.js` 后缀 | tsc/vitest 全绿，合并后运行时 `ERR_MODULE_NOT_FOUND` | ESM 硬要求，import 一律带 `.js` |
| 12 | accept 内嵌复杂 `node -e` 多行脚本 | 报 `Not: command not found` 之类碎片错误 | accept 会被解析管线打碎，只用 `test -f`/`grep`/`tsc`/`vitest` 简单串联 |
| 13 | 新符号与既有模块语义撞名 | 实现 agent 反复去改旧模块，真功能永不出现却全绿 | 起名避开现有模块语义；作者测试 import 真函数（双保险） |
| 14 | spec 文件放 `docs/specs/`（untracked）再发射 | merge 报「与 main 冲突」拒合 | plan 会把同名 normalized spec 提交进集成分支，与 untracked 副本相撞。spec 写到仓外（如 `~/cockpit-specs/`），plan 吃绝对路径 |
| 15 | 一份 spec 塞 5+ 个 flow | lint 告警 `flows-many`；失败面扩大难收割 | 拆成多个 plan 串行跑，每盘 ≤4 流 |

---

## 五、发射与收割（速记）

- **基线用本地 `main`**（不是 origin/main），worktree/克隆从本地 main 开；发射前 `git rev-parse HEAD main` 对比，主树常被后台 loop 切到游离旧 commit，别拿陈旧源码当基线。
- **`kunpeng plan` 必须从 git 根跑**；输出别 `| head`（SIGPIPE 杀进程）。后台起跑用 `nohup … > log 2>&1 & disown` 单层后台，别叠 `run_in_background` 双重后台。
- 进度看 `.kunpeng/state/<flowId>.json`（读 `pid` 字段盯真实进程）与 `.kunpeng/cockpit/logs/run-*.log`。
- **收割走 `kunpeng autopilot`**（自动 mergeAndClearGate + 空提交驳回）；合并前对抗审查：`git diff --name-only main...<分支>` 非空、无 sprawl、作者测试没被改弱；合并后跑**全量** vitest + `npx tsc -p tsconfig.json`（产出构建，光 `--noEmit` 不更新 dist）。verified ≠ 正确。
- 合并主干是人工门#1，绝不自动合 main。
