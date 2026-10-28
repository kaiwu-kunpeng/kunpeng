# 鲲鹏 · 全局治理与接管协议（GOVERNANCE）

> **这是面向所有 agent 的权威文档。** 任何在鲲鹏纳管的项目里工作的 agent（无论 Claude / Codex / 其他工具），开始动手前都应读到本文件，知道鲲鹏在接管技术后台、以及统一的工作流与边界。
>
> 生效日期：**2026-06-14** ｜ 来源：`~/kunpeng/`（鲲鹏 HOME）｜ 配套：[宪法 core.md](../constitution/core.md) · [协作 COORDINATION.md](../COORDINATION.md) · [升级路线 UPGRADE](./UPGRADE-2026-06-13.md)

---

## 一、分工（新规矩）

> **其他 agent 只负责「方案」的产出；鲲鹏全面接手技术后台。**

| 角色 | 负责 | 不负责 |
|---|---|---|
| **方案 agent**（含各项目原有 agent） | 产出需求/方案/spec（`方案.md`：要做什么、为什么、验收标准） | 不直接改代码、不合主干、不发布 |
| **鲲鹏**（技术后台） | 分解 → 实现 → 验证 → 集成 → 发布就绪 → 运维 → 知识沉淀 | 不发明需求；不在人工门未批时合并/发布 |

落到一句话：**你写清楚「做什么 + 怎样算做对」，技术执行交给鲲鹏。**

---

## 二、统一工作流（每个需求都走这条线）

```
方案 agent ──方案.md(带验收标准)──▶ 鲲鹏接线员
                                        │
                          Concierge 分解：方案 → N 条技术 flow（每条带验收命令）
                                        │   并行、单写者隔离、各自 git worktree
                          dev-cycle ×N：spec翻译 → 测试审计 → 实现 → 差分真验证 → 提交 kp/<flow>
                                        │
                          人工门：合并主干 / 对外发布（其余全自动）
                                        ▼
                          知识库同步 + 自进化沉淀
```

- **验证不可造假（C3）**：验收命令来自方案/spec，实现者不得自行弱化。优先用方案直接带来的 `--accept` 精确命令。
- **差分验证**：真项目基线常本就红，门只拦「基线之外的新错」，不要求整项目全绿。
- **单写者 + worktree 隔离（C1）**：每条 flow 在独立 worktree 改代码，互不踩踏；验证过的留在 `kp/<flow>` 分支。

---

## 三、三道人工门（C5，鲲鹏永不自动越过）

1. **合并主干**（`kp/<flow>` → `main`）
2. **修改宪法**（`constitution/core.md`）
3. **对外发布 / 部署**（推远端、上线）

其余全流程自动。人工门在 `kunpeng serve` 后台可一键操作（合并/批准）。

---

## 四、鲲鹏对你的项目的边界（绝不做的事）

- **不覆盖**你项目现有的 `AGENTS.md` / `CLAUDE.md`——鲲鹏自己的规矩写到 `.kunpeng/AGENTS.kunpeng.md`，不动你的配置。
- 子 agent **继承并遵守**你项目现有的 `AGENTS.md`/`CLAUDE.md`（守同一套规则）。
- **合并用临时 worktree**，绝不在你的共享工作树上 `git checkout` 切分支——不夺你正在用的工作区。
- 冲突即**中止**并归为人工门，不强行合并。
- 未经人工确认，**不改代码、不合主干、不推远端、不部署**。

---

## 五、如果你是某项目里被暂停/等待鲲鹏的 agent

- 照常保留你的分支与工作区，鲲鹏不会动它。
- 正式接手会有**明确动作 + 人工确认**，不会无声切换。
- 接手后，技术执行走上面的工作流；你回到「产出方案」的角色。

---

## 六、给人类（项目主）的入口

```bash
# 桥接到某真项目（目标仓库），受理一个需求并跑完整开发流
kunpeng run "<需求>" --repo <目标仓库> [--accept "<精确验收命令>"]

# 只读体检（守护扫描：typecheck/lint/TODO）
kunpeng guard --repo <目标仓库>

# 打开运营后台（红绿灯 / agent 在哪条流@阶段 / ETA / 卡点 / 人工门一键操作）
kunpeng serve [port] --repo <目标仓库>

# 把鲲鹏规矩 stamp 进目标仓库（非覆盖）
kunpeng compile --repo <目标仓库>
```

> 环境变量：`KUNPENG_HOME`=宪法/角色卡来源（默认安装目录）｜`KUNPENG_REPO`=默认目标仓库｜`KUNPENG_BACKEND`=`claude`(默认)/`codex`/未设=混合(implement→codex/审计派活→claude)，均用**登录态 CLI，零 API key**。

---

## 七、跨端项目看板协议（`kunpeng-board/v1`）

> **面向所有工具的 agent（claude / codex / cursor / …）。** 这是跨工具共享项目进度的标准状态面。

- **写**：每个项目根的 `.kunpeng/board.json`（机读）+ `.kunpeng/BOARD.md`（人/agent 读）声明该项目当前进度。鲲鹏纳管的项目由 `kunpeng board`（及 plan/run 结束、`serve` 每 10s）自动写、自动保鲜。**其他工具的 agent（如你 codex）接手一个项目时，也应按本 schema 写自己的 `.kunpeng/board.json`**，让鲲鹏与别的 agent 能看到你那边的进度。
- **读**：任何 agent 在仓库里读 `.kunpeng/BOARD.md` 即知进度，**不需懂鲲鹏内部**。鲲鹏总控台聚合各项目的 `board.json` 显示在同一面（跨工具）。
- **schema `kunpeng-board/v1`**（board.json）：`{ schema, generatedAt, project:{id,name,repoPath}, systemLight:"red|yellow|green", activeFlows:[{flowId,stage,requirement}], plans:[{id,status,merged,desc}], humanGates:[{what,detail}], blockers:[{flowId,reason}], passedLines }`。
- **接管（adopt）**：鲲鹏接手某工具的项目开发时，读/建其 BOARD → 注册 → 按本治理协议走统一工作流；交还时也更新 BOARD。

---

*本协议随鲲鹏演进。修改本文件等同治理变更，应经人工确认。*
