// 鲲鹏生成层"设计系统提示词"组合器。纯函数,零依赖,无 IO。
// baseline = vendored 官方 frontend-design skill 正文(由调用方读入后传进来);本模块只负责组合。

export const PROPRIETARY_DESIGN_RULES: string = `鲲鹏专有层是叠在官方基线之上的硬约束,优先级高于通用审美建议。

1. 三大默认审美黑名单:不要把页面落成 #F4F1EA 暖奶油底,不要用 acid-green 荧光绿/朱红制造廉价冲突,不要做 broadsheet 报纸密排栏。留白、密度、层次必须服务任务,不能滑向这三种默认模板。
2. signature 原则:每页只押一个招牌元素,可以是一个强识别图形、材质、版式动作或交互瞬间;其余元素保持克制,避免多个视觉主角互抢。
3. 可用性底线:正文对比度 >= 4.5:1,主要触控目标 >= 44px,动效控制在 150-300ms,并保留清晰的 focus-visible 状态。
4. 图标与字体:禁 emoji 当图标,需要图标时使用 SVG 或项目内图标系统;禁默认字体兜底,必须显式选择并保持字体策略一致。
5. 色彩禁区:禁紫蓝渐变作为主视觉捷径,除非 brief 明确要求且能证明它服务品牌或语义。
6. 中英 copy 即设计材料:按 brief.locale 输出中文或英文,主动语态、短句优先,全流程同一对象保持同名,避免中英混排造成信息层级混乱。
7. 样式写法硬约束:禁止任何 inline style 写颜色/字号,一律走 CSS 变量与语义 class。
8. 类名来源硬约束:禁止自造未定义的工具类名,只使用本方案 tokens.css 与标准 CSS。`;

export interface ComposeOpts {
  baseline: string;
  brand?: string;
  brief?: string;
  anchor?: string;
  reference?: string;
}

export function composeDesignSystemPrompt(opts: ComposeOpts): string {
  const sections = [
    `# 设计基线(官方方法论)\n${opts.baseline}`,
  ];

  if (opts.brand) {
    sections.push(`# 品牌(单一真相,优先级高于以下所有)\n${opts.brand}`);
  }

  sections.push(`# 鲲鹏专有设计规则(优先级高于基线的硬约束)\n${PROPRIETARY_DESIGN_RULES}`);

  if (opts.anchor) {
    sections.push(`# 本次风格锚\n选定锚:${opts.anchor};锁定其调色/字体/材质,禁与其它锚混搭。`);
  }

  if (opts.brief) {
    sections.push(`# 本次设计 BRIEF\n${opts.brief}`);
  }

  if (opts.reference) {
    sections.push(`# 参考(风格迁移,朝它走但仍守专有规则)\n${opts.reference}`);
  }

  return sections.join("\n\n");
}
