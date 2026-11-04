# CLAUDE.md

鲲鹏（kunpeng）—— 多 agent 编排器：spec 驱动的开发循环（plan/run/merge）+ 自我进化护栏 + 驾驶舱。TypeScript / Node.js（>=20，ESM 单仓），主包在 `orchestrator/`，CLI 入口 `orchestrator/src/cli.ts`（bin: `kunpeng` → `dist/cli.js`）。

## 最高优先规则（宪法，全文 @AGENTS.md）

- **改鲲鹏自身功能一律走自建循环 `kunpeng plan <spec>` / `run`**，严禁手改源码绕过 loop（C11"漂移"）；例外仅自举/紧急恢复且经人类当次同意
- 只动 spec scope allow 内的文件，绝不删除/重命名/覆盖 allow 外的任何既有文件（C10）
- 声明"完成"必须附真实验证证据（test/lint 的实际输出），无证据 = 未完成（C3）
- `AGENTS.md` 是编译产物（源在 `constitution/core.md`、`constitution/conventions.md`、角色卡），勿手改，改源后重新编译
- `constitution/core.md` 不可变；约定类改动走自我进化提案 + 人工门

## 常用命令（在 `orchestrator/` 下执行）

```bash
npm run verify          # 全量门 = lint + typecheck + test
npm run lint            # eslint src test
npm run typecheck       # tsc --noEmit + 测试 tsconfig
npm run test            # vitest run
npm run test:unit       # 排除 *.integration.test.ts
npm run test:integration
npm run test:watch
npm run build           # tsc（带构建锁）
npm run format          # prettier
```

- e2e 测试默认排除，`KP_E2E=1` 显式触发
- 测试文件位置：`orchestrator/test/**/*.test.ts` 与 `orchestrator/src/**/*.test.ts`

## 代码风格

- ESM：相对导入必须带 `.js` 后缀
- `strict` TypeScript，禁止显式 `any`（eslint 强制）
- 纯函数 / 副作用隔离；单文件 ≤ ~300–400 行
- 错误处理 fail-closed：不得 `|| true` 吞错；判不定的验证一律判失败；子进程必带超时并到点 kill
- 工程规范全文：`docs/specs/2026-06-14-engineering-standards-and-layout-draft.md`

## 提交与分支

- Conventional Commits：`type(scope): 中文描述`，type ∈ feat/fix/refactor/test/docs/chore/perf；正文写"为什么"；AI 协作提交附 `Co-Authored-By:` trailer
- 分支：鲲鹏自跑开发流用 `kp/<spec-id>-<slug>`；人类/会话开发用 `feat/<topic>`、`fix/<topic>`
- 并发期禁用通配批量删 `kp/plan-*` 分支，只精确删自己的

## 目录地图

```
orchestrator/    主包（src/ 下 40+ 模块：cli、loop、spec、plan、verify、runtime、
                 compile、security、policy、evolution、cockpit、server、codegraph 等）
constitution/    宪法源（core.md 不可变核心 + conventions.md 可演进约定）
loops/           循环定义（dev-cycle / product-cycle / self-evolution / guardian）
adapters/        跨工具适配（agents-md / claude-code / cursor）
skills/          agent 技能
docs/            specs / roadmap / decisions / product
deploy/          部署套件（aliyun / aws）
artifacts/       流产物
```

## 事实源规则

- 指标/正确性判定（行数、文件清单、内容）一律走 main git ref（`git grep -c` / `ls-tree` / `show`），不读工作树
- 运行代码只用镜像部署（`~/kunpeng-cron` / `~/kunpeng-serve`），勿从 `~/kunpeng/orchestrator/dist` 跑命令
- 产出给用户阅读的文档必须同时生成同名 `.html`，并用 `kunpeng capture` 落知识库
