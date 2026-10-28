export interface BusinessObject {
  name: string;
  fields: string[];
  views: string[];
  roles?: string[];
  metrics?: string[];
}

export interface ProductTemplate {
  id: string;
  label: string;
  storySeeds: string[];
  acceptanceSeeds: string[];
  conventions: string[];
  objects?: BusinessObject[];
  qaScriptSeed?: Array<{ action: string; target?: string; value?: string; note?: string }>;
}

export const PRODUCT_TEMPLATES: readonly ProductTemplate[] = [
  {
    id: "saas",
    label: "SaaS 产品",
    storySeeds: [
      "作为团队管理员，我可以邀请成员并分配角色，以便团队按权限协作使用产品。",
      "作为付费客户，我可以查看当前套餐、用量和续费状态，以便控制订阅成本。",
      "作为一线用户，我可以在核心工作流中保存进度并稍后继续，以便不中断日常任务。",
    ],
    acceptanceSeeds: [
      "管理员能完成邀请、改角色、移除成员三项操作，普通成员无法进入权限管理入口。",
      "订阅页展示套餐名、周期、到期时间和关键用量，缺失计费数据时给出可恢复的错误提示。",
    ],
    conventions: [
      "多租户数据必须在 schema/model 层显式带 tenantId，查询入口默认按 tenantId 隔离。",
      "套餐、试用、欠费、取消和恢复必须建成显式计费状态机，UI 不直接推断计费状态。",
      "团队成员与角色权限必须集中建模，关键写操作在服务层检查角色。",
      "用量统计必须可回放或可重算，避免只依赖前端展示值作为计费依据。",
    ],
    objects: [
      {
        name: "团队成员",
        fields: ["姓名", "邮箱", "角色", "邀请状态", "最近活跃时间", "所属团队"],
        views: ["成员列表", "权限矩阵", "邀请记录"],
        roles: ["团队管理员", "普通成员"],
        metrics: ["活跃成员数", "邀请接受率"],
      },
      {
        name: "订阅账户",
        fields: ["套餐名称", "计费周期", "订阅状态", "下次续费日", "席位上限", "已用席位"],
        views: ["订阅概览", "用量明细", "发票列表"],
        roles: ["账单管理员", "团队管理员"],
        metrics: ["月经常收入", "席位使用率"],
      },
    ],
    qaScriptSeed: [
      { action: "goto", target: "/" },
      { action: "expectText", target: "团队" },
      { action: "expectText", target: "套餐" },
    ],
  },
  {
    id: "crm",
    label: "CRM 客户关系管理",
    storySeeds: [
      "作为销售，我可以记录客户联系人、公司和沟通历史，以便接手同事能快速理解上下文。",
      "作为销售主管，我可以按阶段查看商机漏斗，以便发现卡住的成交机会。",
      "作为客服同事，我可以在客户页看到最近工单和跟进人，以便避免重复打扰客户。",
    ],
    acceptanceSeeds: [
      "客户详情页至少展示联系人、公司、最近沟通、负责人和下一步动作。",
      "商机列表支持按阶段筛选，并能准确统计每个阶段的商机数量和金额。",
    ],
    conventions: [
      "联系人、公司、商机和活动时间线必须是一等模型，不把沟通历史塞进备注字符串。",
      "客户导入必须用外部 id、邮箱或手机号做幂等键，重复导入不得创建重复客户。",
      "沟通记录必须 append-only 保存，并记录创建人、时间、渠道和下一步动作。",
      "漏斗阶段必须用枚举状态驱动统计，金额与数量从同一套商机数据聚合。",
    ],
    objects: [
      {
        name: "客户",
        fields: ["名称", "公司", "负责人", "阶段", "最近沟通时间", "下一步动作"],
        views: ["客户列表", "按阶段看板", "负责人列表"],
        roles: ["销售", "销售主管", "客服"],
        metrics: ["新增客户数", "跟进逾期数"],
      },
      {
        name: "商机",
        fields: ["客户", "金额", "阶段", "预计成交日", "负责人", "赢单概率"],
        views: ["商机漏斗", "按阶段看板", "预测成交列表"],
        roles: ["销售", "销售主管"],
        metrics: ["商机金额", "阶段转化率"],
      },
    ],
    qaScriptSeed: [
      { action: "goto", target: "/" },
      { action: "expectText", target: "客户" },
      { action: "expectText", target: "商机" },
    ],
  },
  {
    id: "internal-tool",
    label: "内部工具",
    storySeeds: [
      "作为运营人员，我可以批量处理重复记录，以便减少手工复制粘贴。",
      "作为审核人员，我可以看到操作前后的差异，以便确认变更不会误伤数据。",
      "作为管理员，我可以追踪谁在什么时间执行了关键操作，以便事后审计。",
    ],
    acceptanceSeeds: [
      "高风险操作必须先展示影响范围和确认入口，未确认时不得提交。",
      "操作日志记录操作者、时间、输入摘要、结果状态和失败原因。",
    ],
    conventions: [
      "内部工具优先实现单页工作台，除非 spec 明确要求，不主动接入外部登录系统。",
      "批量或高风险操作必须先计算影响范围并展示 dry-run 预览，确认后才提交。",
      "可撤销操作必须记录 inverse patch 或恢复点，无法撤销的操作必须在 UI 标明。",
      "所有关键操作必须写审计日志，包含操作者、输入摘要、影响数量和失败原因。",
    ],
    objects: [
      {
        name: "批量任务",
        fields: ["任务名称", "输入条件", "影响数量", "执行状态", "创建人", "失败原因"],
        views: ["任务队列", "执行结果列表", "影响预览"],
        roles: ["运营人员", "管理员"],
        metrics: ["处理成功数", "失败任务数"],
      },
      {
        name: "审计日志",
        fields: ["操作者", "操作时间", "操作类型", "输入摘要", "结果状态", "恢复点"],
        views: ["审计时间线", "操作者明细", "高风险操作列表"],
        roles: ["审核人员", "管理员"],
        metrics: ["高风险操作数", "撤销次数"],
      },
    ],
    qaScriptSeed: [
      { action: "goto", target: "/" },
      { action: "expectText", target: "操作" },
      { action: "expectText", target: "日志" },
    ],
  },
  {
    id: "landing-page",
    label: "落地页",
    storySeeds: [
      "作为访客，我可以在首屏理解产品解决的问题和适合的人群，以便判断是否继续浏览。",
      "作为潜在客户，我可以查看真实案例或关键数据，以便建立信任。",
      "作为转化负责人，我可以让访客在页面内完成预约、注册或咨询，以便降低流失。",
    ],
    acceptanceSeeds: [
      "首屏包含明确标题、价值说明和主行动按钮，移动端 375px 宽度下不遮挡。",
      "主行动按钮在首屏和页面末尾各出现一次，并指向同一个可完成的转化动作。",
    ],
    conventions: [
      "首屏标题、价值说明和主 CTA 必须由 HTML/CSS 静态渲染，不能依赖客户端 JS 才可见。",
      "表单必须提供无 JS 降级提交路径，提交失败时保留已填字段并显示可恢复错误。",
      "首屏图片和关键媒体必须声明尺寸或 aspect-ratio，避免加载后造成布局跳动。",
      "页面必须包含 title、description 和可分享的 Open Graph 元信息。",
    ],
    objects: [
      {
        name: "首屏内容",
        fields: ["标题", "价值说明", "主行动按钮", "目标人群", "首屏媒体", "信任数据"],
        views: ["桌面首屏", "移动端首屏", "转化入口"],
        roles: ["访客", "转化负责人"],
        metrics: ["首屏点击率", "跳出率"],
      },
      {
        name: "咨询线索",
        fields: ["姓名", "联系方式", "公司", "需求描述", "来源渠道", "提交时间"],
        views: ["线索表单", "提交成功页", "线索列表"],
        roles: ["潜在客户", "销售"],
        metrics: ["表单提交数", "线索转化率"],
      },
    ],
    qaScriptSeed: [
      { action: "goto", target: "/" },
      { action: "expectText", target: "预约" },
      { action: "expectSelector", target: "button" },
    ],
  },
  {
    id: "dashboard",
    label: "Dashboard 仪表盘",
    storySeeds: [
      "作为管理者，我可以在一个屏幕看到核心指标的当前值、趋势和异常，以便快速判断状态。",
      "作为分析人员，我可以按时间范围和业务维度筛选图表，以便定位变化原因。",
      "作为值班同事，我可以从异常指标跳转到明细列表，以便继续排查具体记录。",
    ],
    acceptanceSeeds: [
      "每个核心指标展示名称、当前值、环比变化和更新时间，数据为空时显示明确空态。",
      "筛选条件改变后，指标卡、图表和明细列表使用同一条件刷新，不能出现口径不一致。",
    ],
    conventions: [
      "每个指标的计算口径必须写在计算函数或查询旁的代码注释里，避免 UI 文案替代口径。",
      "指标卡、图表和明细列表必须共享同一个筛选对象，禁止各自拼接时间范围。",
      "空数据、加载失败和无权限必须显示不同状态，空态要说明数据为什么为空。",
      "所有时间范围计算必须显式处理时区和边界，默认值不得散落在多个组件里。",
    ],
    objects: [
      {
        name: "核心指标",
        fields: ["指标名称", "当前值", "环比变化", "更新时间", "计算口径", "异常阈值"],
        views: ["指标卡片", "趋势图", "异常指标列表"],
        roles: ["管理者", "分析人员"],
        metrics: ["指标达成率", "异常数量"],
      },
      {
        name: "筛选条件",
        fields: ["时间范围", "业务维度", "地区", "负责人", "数据来源", "刷新频率"],
        views: ["筛选栏", "已选条件摘要", "明细列表"],
        roles: ["分析人员", "值班同事"],
        metrics: ["筛选使用次数", "明细下钻次数"],
      },
    ],
    qaScriptSeed: [
      { action: "goto", target: "/" },
      { action: "expectText", target: "指标" },
      { action: "expectText", target: "趋势" },
    ],
  },
  {
    id: "ai-agent",
    label: "AI Agent",
    storySeeds: [
      "作为用户，我可以给 agent 一个目标和边界条件，以便它分解任务并持续推进。",
      "作为监督者，我可以查看 agent 的计划、工具调用和中间结果，以便发现偏航。",
      "作为系统管理员，我可以限制 agent 可访问的数据和可执行动作，以便降低越权风险。",
    ],
    acceptanceSeeds: [
      "agent 执行前展示计划和关键风险，高风险外部动作必须等待人工确认。",
      "每次工具调用记录输入摘要、输出摘要、耗时和失败原因，失败后给出可重试路径。",
    ],
    conventions: [
      "每个工具调用必须设置超时、重试上限和失败兜底，超时后要记录可诊断错误。",
      "对话消息、计划和工具调用日志必须结构化保存，并支持导出为 JSON 或 Markdown。",
      "模型输出进入工具参数前必须经过 schema 校验，校验失败不得执行工具。",
      "高风险外部动作必须带 risk 标记并进入人工确认队列，不能由 agent 自动放行。",
    ],
    objects: [
      {
        name: "Agent 任务",
        fields: ["目标", "边界条件", "计划步骤", "当前状态", "风险等级", "负责人"],
        views: ["任务列表", "计划详情", "风险确认队列"],
        roles: ["用户", "监督者"],
        metrics: ["任务完成率", "人工确认次数"],
      },
      {
        name: "工具调用",
        fields: ["工具名称", "输入摘要", "输出摘要", "耗时", "失败原因", "重试次数"],
        views: ["调用时间线", "失败调用列表", "调用详情"],
        roles: ["监督者", "系统管理员"],
        metrics: ["调用成功率", "平均耗时"],
      },
    ],
    qaScriptSeed: [
      { action: "goto", target: "/" },
      { action: "expectText", target: "任务" },
      { action: "expectText", target: "计划" },
    ],
  },
  {
    id: "form-workflow",
    label: "表单工作流",
    storySeeds: [
      "作为申请人，我可以分步骤填写表单并保存草稿，以便补齐材料后继续提交。",
      "作为审批人，我可以按状态处理待办并填写审批意见，以便流程可追踪。",
      "作为流程管理员，我可以配置必填项、校验规则和审批节点，以便适配不同业务。",
    ],
    acceptanceSeeds: [
      "表单提交前逐项校验必填、格式和跨字段规则，错误信息定位到具体字段。",
      "流程状态至少覆盖草稿、已提交、审批中、退回、通过和拒绝，并记录每次状态变更。",
    ],
    conventions: [
      "每个表单步骤必须支持保存草稿，刷新或返回后能从最近草稿继续填写。",
      "审批链和状态迁移必须 append-only 记录，包含操作者、时间、意见和前后状态。",
      "字段校验必须区分前端即时提示与服务端最终校验，服务端校验结果以字段路径返回。",
      "审批节点必须显式记录负责人、决策、评论和时间戳，便于完整回溯。",
    ],
    objects: [
      {
        name: "表单申请",
        fields: ["申请人", "表单步骤", "字段值", "草稿状态", "提交时间", "校验错误"],
        views: ["分步表单", "草稿列表", "提交确认页"],
        roles: ["申请人", "流程管理员"],
        metrics: ["草稿保存数", "提交完成率"],
      },
      {
        name: "审批记录",
        fields: ["审批人", "审批节点", "审批意见", "前置状态", "后置状态", "处理时间"],
        views: ["待办列表", "审批时间线", "状态看板"],
        roles: ["审批人", "流程管理员"],
        metrics: ["平均审批时长", "退回率"],
      },
    ],
    qaScriptSeed: [
      { action: "goto", target: "/" },
      { action: "expectText", target: "表单" },
      { action: "expectText", target: "审批" },
    ],
  },
];

export function templateById(id: string): ProductTemplate | undefined {
  return PRODUCT_TEMPLATES.find((template) => template.id === id);
}

export function templateConventionsBlock(template: ProductTemplate | undefined): string {
  if (!template || template.conventions.length === 0) return "";
  return ["## 模板约定（必须遵守）", ...template.conventions.map((convention) => `- ${convention}`)].join("\n");
}

export function templateObjectsBlock(template: ProductTemplate | undefined): string {
  if (!template?.objects || template.objects.length === 0) return "";
  const lines = ["## 业务对象模型"];
  for (const object of template.objects) {
    lines.push("", `### ${object.name}`, "", "字段：", ...object.fields.map((field) => `- ${field}`), "", "视图：", ...object.views.map((view) => `- ${view}`));
    if (object.roles?.length) {
      lines.push("", "角色：", ...object.roles.map((role) => `- ${role}`));
    }
    if (object.metrics?.length) {
      lines.push("", "指标：", ...object.metrics.map((metric) => `- ${metric}`));
    }
  }
  return lines.join("\n");
}

export function mergeTemplateStories<T extends { stories: string[]; acceptance: string[] }>(
  def: T,
  template: ProductTemplate,
): T {
  return {
    ...def,
    stories: uniqueAppend(def.stories, template.storySeeds),
    acceptance: uniqueAppend(def.acceptance, template.acceptanceSeeds),
  } as T;
}

function uniqueAppend(original: string[], seeds: string[]): string[] {
  const seen = new Set(original);
  const merged = [...original];
  for (const seed of seeds) {
    if (seen.has(seed)) continue;
    seen.add(seed);
    merged.push(seed);
  }
  return merged;
}
