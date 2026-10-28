# 鲲鹏设计 Loop —— 方法、工具与落地方案

> 状态:方案待评审(用户过目后再决定建/从哪起步)。
> 适用范围:鲲鹏 cockpit 与产品页面设计;并延伸到**产品 PPT(中英文)**。
> 一句话:把业界最好的设计机制按「进口→编码→产出→核验→记忆」拼成一个**带记忆的闭环**,这就是鲲鹏独有的东西——别人有单点工具,我们有 loop + LoopStore,让它越用越准。

---

## 0. 为什么要做这件事(问题)

我们已有一条自建 TS 设计流水线:知识库 BM25 选风格/配色/字体 + 类三层 token + 反AI味门禁 + CLI `kunpeng design` + cockpit 设计面板。做"三选一"对比(我们的 TS / Google Material / Claude design)时暴露出 4 个结构性痛点:

1. **一句话没被扩写成完整 brief** —— 工具拿不到方向,只能出模板货。
2. **配色靠规则匹配硬编码** —— 不会从一个种子色算出和谐、可访问的完整色阶,没有暗色模式。
3. **没有"品味"** —— 产出容易撞上"一眼 AI"的通用感。
4. **没有迭代闭环** —— 不看渲染图、不截图复评,生成完就完了。

更扎心的发现:我们自己的流水线推荐"玻璃拟态 + 靛蓝→青渐变",却被我们自己的反AI味门禁拒了(紫蓝渐变 + blur 滥用)——**出方案的模块和质检的模块自相矛盾**。这正是要系统性升级的信号。

---

## 1. 调研综述:好设计的 AI 系统都怎么做

跨 6 路独立调研(GitHub 设计技能生态、AI 设计产品+泄漏提示词、OKLCH/APCA 配色引擎、8 个设计技能仓库深读、Claude 官方 frontend-design、Google Stitch、Figma 生态)交叉验证出的**铁律**:

- **质量来自"约束式脚手架",不是自由生成。** v0/Lovable/Bolt/Subframe 全靠"锁定真组件库 + 语义 token + 反通用感明令"兜底;模型本身差距很小,护城河是 **token 上下文层 + 变体选择 + 导入管线**。
- **入口必须把一句话扩写成结构化 brief。** Claude 官方 skill 强制先钉死"主体+受众+页面唯一任务+一个 signature";Stitch/tweakcn 都先 enhance-prompt 再生成。
- **品味 = 强制对照 + 一处冒险,不是规则堆。** 两遍法(plan→自审是否撞 AI 默认审美→build→看图复评)+ "把胆量集中花在一个招牌元素上"。
- **配色要算不要查。** 种子色经 OKLCH/HCT 算完整 12 阶 + 明暗双模,**对比度(APCA)当生成期硬约束**(前景是"解"出来的不是选的)。
- **最高杠杆的一件事:截图反馈闭环。** Playwright/MCP 双视口截图 → vision 看图找溢出/对比/通用感 → 自动修。

---

## 2. 鲲鹏设计 Loop:五段闭环

```
一句话需求
   │
   ▼
①BRIEF 门 ──▶ ②风格锚+算法配色 ──▶ ③生成·fan-out ──▶ ④截图复评·门禁 ──▶ ⑤记忆回灌
   ▲                                                                              │
   └──────────────────────────────────────────────────────────────────────────────┘
                         (decisions.jsonl → LoopStore,下一轮候选重排序)
```

### ① BRIEF 门(进口)—— 解痛点①
**目标**:把"一句话"逼成有方向的结构化 brief,未达标不准往下。
**机制**(抄 ux-skill 10 字段 + tasteful-ui 投资门 + Stitch enhance-prompt + Claude"先钉主体"):
- 强制 10 字段:项目类型 / 受众 / 主目标(页面唯一职责)/ 语气(**禁用空词 "modern""clean"**)/ 必备项 / **禁止动作**(如紫渐变、brutalism)/ 参考品牌 / 技术栈 / **地区(中/英双轨)** / 成功指标。
- 品味方向用**产品契合句**表达(如"a calm archive search tool, preserving institutional cue"),不是风格名。
- 把泛词自动替成具体值:"蓝" → hex;"现代间距" → 8px 栅格;"按钮" → 精确组件名。
- **投资门**:字段没答全,不准读参考、不准写码——阻止在错误方向上继续投入。
**产出**:`BRIEF.md`(中英双轨字段)。**自建。**

### ② 风格锚 + 算法配色(编码)—— 解痛点②③
**目标**:把"品味"和"配色"从玄学变成可确定性执行的两步。
**机制**:
- **风格锚单选 + 锁 token + 禁混搭**(抄 Ilm-Alan 8 锚):Swiss / Industrial / Brutalist / Aurora Maximalism / Chaotic Maximalism / Retro-Futuristic / Organic / Lo-Fi —— 每个锚把调色板+字体+材质硬绑到具体 CSS;**选一个就坚持一个**,禁止"Swiss with a Brutalist edge"四不像。
- **算法配色引擎**(抄 Material/OKLCH + Figma 思路):种子色 → `@material/material-color-utilities`(HCT)生成 primary/secondary/tertiary/neutral/error 五条 tonal palette → `culori`(OKLCH,gamut clamp)落成 Radix 式 12 阶 → **APCA 求解前景**(固定背景,沿 L 轴搜出满足 Lc≥60/90 的前景,不达标 throw)→ 明暗双模(mode = 变量的列,semantic 不变只切引用)。均零依赖纯 JS,Node 直跑。
- **token 三层 + DTCG**(抄 Figma):primitive(`--blue-1..12`)→ semantic(直接用 **shadcn 名集** background/foreground/primary/muted/ring…)→ component。输出 W3C **DTCG** `$value`/`$type`,白嫖 Style Dictionary 编译链,产物可 `npx shadcn add`。
- **可量化品味硬阈值**(抄 pencilplaybook):正文对比 ≥4.5:1、hover 亮度差 ≥8%、动效时长地板 100ms、触控 44×44(移动)/24(桌面)、字距随字号。
**产出**:`MASTER` 设计系统(token JSON + CSS 变量,明暗双模)。**配色引擎自建;token 体系对齐生态。**

### ③ 生成 + fan-out(产出)—— 解痛点③
**目标**:生成不撞默认审美、给用户挑的多方向产物。
**机制**(抄 Claude 两遍法 + v0/Stitch 多变体):
- 先产 **token 计划四元组**再写码:Color(4–6 命名 hex)/ Type(≥2 角色:展示字体+正文+数据字体)/ Layout(一句话+ASCII 线框)/ **Signature**(本页被记住的唯一元素)。
- **对照"三大 AI 默认审美黑名单"自审**(Claude 官方提炼,见 §6),走一遍"换个相似 prompt 我会不会落到同一处",像默认就改并说明改了什么。
- **fan-out 3–4 个方向**让 cockpit 选(而非一发)。
- 产物 = starter CSS / **shadcn `registry-item.json`**(cssVars 三作用域,可一键安装)。
**生成层直接用 Claude 官方 frontend-design skill**(见 §4),不重复造。

### ④ 截图复评 + 门禁(核验)—— 解痛点④
**目标**:看真渲染图迭代,把"反AI味门禁"从扫文本升级成算对比度 + 看图。
**机制**(抄 jezweb design-loop + Claude 边做边截图 + avoid-ai-design 分级 + senior-designer 打分):
- **截图复评**:用 **chrome-devtools MCP(我们已有)** 截桌面 1280px + 移动 375px → vision 模型自评(溢出/对比不足/通用感)→ 自动修。
- **三层门禁**:① 确定性 linter(无 LLM、regex、~200ms:紫蓝渐变 / 三等宽卡 / Inter-for-everything / 未改的 shadcn base / lorem 泄漏 + 三大默认审美)→ ② P0/P1/P2 分级(P0 外行能认出是 AI / P1 设计师能认出 / P2 工艺差距)→ ③ 决策三元组(每个决定写"选了什么+否决的两个备选+为什么")+ 打分**满分才发**。
- 接力棒文件 `next-prompt.md` 驱动多页/多张幻灯片连续产出。
**门禁升级自建;截图接现成 MCP。**

### ⑤ 记忆回灌(让 loop 越用越准)—— 鲲鹏独有
**目标**:每轮设计的胜出经验沉淀,反哺下一轮——这是别人单点工具没有、而我们有 LoopStore 能做的护城河。
**机制**(抄 ux-skill 决策账本 + 我们已有 LoopStore):
- 每轮胜出方案按 `(行业, UI 类型)` 桶写入 `decisions.jsonl` → **接鲲鹏 LoopStore** → 下次同类需求的候选(风格锚/配色/字体)按历史胜绩重排序。
**自建(对接已有 LoopStore)。**

---

## 3. 工具分工:用好哪些、自建哪些

| 角色 | 用什么 | 为什么 |
|---|---|---|
| **生成层** | **Claude 官方 frontend-design skill**(277K 装机) | 方法论最成熟;学它的"三大默认黑名单 + signature 承诺"焊进我们门禁 |
| **快速探索/风格迁移** | **Google Stitch**(图→UI、多屏一致) | 我们缺的"参考图→UI""多屏一致"能力,调用即可,不自建 |
| **token 事实源 + 设计↔代码桥** | **Figma**(Variables→DTCG→Style Dictionary;MCP server;Code Connect) | 对齐主流生态;MCP 当结构化设计上下文源;Code Connect 做组件→代码契约(反漂移一致性) |
| **配色引擎** | 自建(`material-color-utilities` + `culori` + `apca-w3`,均零依赖) | 确定性强、可测试,是护城河 |
| **截图复评** | **chrome-devtools MCP**(已有) | 一图胜千 token,契合省 token 方向 |
| **BRIEF 门 / 记忆回灌** | 自建(对接已有 LoopStore) | 我们独有的入口与记忆层 |

**结论:自建的只有三块——① BRIEF 门、② 配色引擎、⑤ 记忆回灌。其余"用好工具"即可。**

---

## 4. 反AI味门禁升级:三大默认审美黑名单(Claude 官方提炼)

当前 AI 设计聚集成三种"默认而非选择"的样子,要焊进 linter:
1. **暖奶油底 `#F4F1EA` + 高对比衬线 + 赤陶色强调**;
2. **近黑底 + 单一荧光绿/朱红强调色**;
3. **报纸式 hairline 细线分隔、零圆角、密排栏**。
规则:**brief 明确要哪种就照做(brief 永远赢);brief 留白的轴,不准把自由度花在这三种默认上。** 配合三条成功测试:Justified(改动服务既定方向)/ Coherent(类型/色/布局强化同一想法)/ **Not a re-run(不是二阶默认,别老抓 Space Grotesk)**。

---

## 5. 产品 PPT(中英文)如何复用同一个 loop

- **① BRIEF 门**:"地区/语气"字段天然支持中/英双轨。
- **② 风格锚 + token**:复用到现有 `deck-visual-style` skill。
- **③ 生成**:"每页一个 signature、其余克制、出门摘一件配饰" + "文案即设计材料"(从用户视角命名、主动语态、全流程同名)——治 PPT 通用感。
- **④ 截图复评**:对幻灯片同样管用;多页一致性抄 Stitch"单平台锁线程 + 批量套主题"。

---

## 6. 分阶段落地路线图

| 阶段 | 内容 | 依赖 | 价值 |
|---|---|---|---|
| **Phase 0(最小可行)** | ① BRIEF 门 + ② 配色引擎(OKLCH+APCA,零依赖) | 无 | 直击"没方向 + 配色弱"两个根因 |
| **Phase 1** | token 三层对齐 DTCG/shadcn;风格锚表 | Phase 0 | 产物可 `npx shadcn add`,接生态 |
| **Phase 2** | ④ 截图复评闭环(chrome-devtools MCP) | MCP(已有) | 补"没迭代"缺口 |
| **Phase 3** | 门禁升级(linter + 三大黑名单 + P0/P1/P2 + 打分) | Phase 1 | 反AI味从扫文本→算对比度+看图 |
| **Phase 4** | ⑤ 记忆回灌(decisions.jsonl → LoopStore) | LoopStore(已有) | loop 越用越准,护城河成型 |

**起步建议:先做 Phase 0**(性价比最高、零依赖、解根因),走鲲鹏自建循环(不手搓)。

---

## 7. 成功标准

- 一句话需求经 BRIEF 门后,工具拿到可执行方向(10 字段齐、有 signature)。
- 任一种子色 → 完整 12 阶 × 明暗双模 token,**全部 APCA 达标**(生成期可证明)。
- 产出过三层门禁:确定性 linter 0 命中 + 不撞三大默认审美 + 满分。
- 截图复评闭环跑通(双视口 → vision 自评 → 修)。
- 同类需求第二次比第一次更准(记忆生效)。
- 同一 loop 能产出产品 PPT(中英文)的一致视觉。

---

## 附录 A:精读到的可复制机制(按仓库)

- **anthropics/claude-code · frontend-design**:三大默认审美黑名单 + 两遍法 + signature 承诺 + "镜子法则"(出门摘一件配饰)。
- **DonkeyKing01/tasteful-ui-skill**:投资门(三道 checkpoint,未答不继续)+ 品味用产品契合句表达 + PROJECT_DESIGN.md。
- **Ilm-Alan/frontend-design**:8 个美学锚 + 锁 token + 禁混搭(hybrid resistance)。
- **sshahzaiib/senior-designer-skill**:决策三元组(决定+两个否决+为什么)+ 打分满分才发 + "3 轮 5 条胜过 1 轮 15 条"。
- **Laith0003/ux-skill**:10 字段强制 brief + 152 条确定性 linter(含 purple-to-blue-gradient / three-equal-card-grid)+ 7 轴合成器 + 冲突矩阵 + decisions.jsonl 决策账本。
- **jezweb/claude-skills · design-loop**:接力棒自循环 + 桌面1280/移动375 截图复评。
- **stevembarclay/pencilplaybook**:感知心理学硬阈值(对比4.5:1 / hover8% / 动效100ms / 触控44px)+ token-first + 动作后核验。
- **funboy322/avoid-ai-design**:AI-slop 模式目录 + P0/P1/P2 分级 + 三条成功测试。
- **Google Stitch**:enhance-prompt(Design System 块 + 编号 Page Structure)+ 单平台锁线程多屏一致 + 图→UI 风格迁移 + 多方向 fan-out。
- **Figma**:Variables(mode=列)+ Tokens Studio/DTCG + Style Dictionary + Dev Mode/MCP server + Code Connect(组件→代码契约)。

## 附录 B:配色引擎最小实现思路(伪代码)

```
seed = hex; mood ∈ {vibrant, neutral, expressive}
scheme = themeFromSourceColor(seed)                 // material-color-utilities → 5 palettes
for role in [primary, secondary, tertiary, neutral, error]:
  for tone in [99,97,93,...12档]:
    prim[role][i] = gamutClamp(oklch(palette[role].tone(tone)))   // culori
// 语义映射(light):bg=step1/2, muted=step3, border=step6/7, ring=step8,
//                  solid=step9, hover=step10, text=step11/12
sem.foreground = solveFg(bg=sem.background, targetLc=90)          // 沿 L 轴二分求解,失败 throw
darkScheme = 同法,tone 表反向
emit → DTCG JSON → Style Dictionary → :root{--background:oklch(...)} + .dark{...}
```

## 附录 C:关键来源

- Claude frontend-design SKILL.md(anthropics/claude-code · plugins/frontend-design)
- Material Color Utilities(material-foundation)、culori、APCA(apca-w3)、Radix Colors、Style Dictionary(DTCG)
- v0 / Lovable / Bolt / Stitch 泄漏系统提示词(jujumilk3/leaked-system-prompts、YeeKal/leaked-system-prompts)
- tweakcn(jnsahaj)、shadcn registry/theming、21st.dev
- Figma MCP server / Code Connect(figma/code-connect)、Tokens Studio

---

## 附:实施现状对照(2026-06-20,与本文档逐项核对)

**已建成并接通(自建循环交付)**:① BRIEF 投资门 · ② 配色引擎 · ③ 生成层(vendored 官方 skill + 组合器)· ④ 门禁(三大默认黑名单 + P0/P1/P2)· ④b 截图复评(design-review + 渲染体检 + CLI 自动回炉 --rounds + 系统 Chrome 真截图 shot.png)· ⑤ 记忆回灌(读写决策 + summarize + co-locate `.kunpeng/loops/design-memory` + `kunpeng design-memory` 读出)· 串联 planDesign/gateDesign · #1 风格锚锁 token · #3 字体进 loop · #4 新旧统一桥 design-suggest(knowledge BM25→种子色+锚)· #5 tokens.css 保真 · 三入口(CLI `kunpeng design-loop`、cockpit「设计工作台」面板含后台生成钮、DevCycle design stage)。

**与本文档的偏差 / 尚未收口(按价值排序)**:
1. **配色对比度用 WCAG 2.1,非 APCA**(本文 §2/§7/附录B 写的是 APCA)。当前 `color-engine.contrastRatio` 走 WCAG 相对亮度(确定、达标);APCA 留作精度升级。**决策:文档对齐为"WCAG 现行 / APCA 后续"**。
2. **产物未输出 shadcn `registry-item.json`**(本文 §3 设想"`npx shadcn add` 白嫖生态")。当前产 `tokens.json`(DTCG)+ `tokens.css`,尚无可一键安装的 registry-item。**未做**。
3. **Stitch / Figma 仅研究、未集成**(本文 §3 列为"用好的工具")。Figma DTCG 导入 / MCP 设计上下文 / Stitch 图→UI 参考,均未接线。**未做(外部工具,按需手动)**。
4. **产品 PPT(中英文)未接 loop**(本文 §5)。brief-gate 有 `locale:"both"`,但未与 `deck-visual-style` skill / 幻灯片生成打通。**未做**。

零 npm 依赖(配色引擎全手写;无 material-color-utilities/culori)。

### 更新(2026-06-20·C/D/E 已补齐)
- **C shadcn 产物**:✅ `design-export.toShadcnRegistryItem` + CLI 落 `registry-item.json`(可 `npx shadcn add`)。
- **D Stitch/Figma**:✅ Figma=`toTokensStudio` 落 `figma-tokens.json`(Tokens Studio 导入)+ DTCG 本就兼容;Stitch=brief 加 `referenceUrl/referenceNotes` 文本参考迁移注入生成提示词。
- **E 产品 PPT 中英文**:✅ `design-deck.composeDeckPrompt`(16:9/单页单点/deck级signature/克制数据图/中英双轨)+ CLI `design-loop --deck [--slides N]`。
- **仅 B(APCA)**仍按"WCAG 现行 / APCA 后续"保留为可选精度升级。
