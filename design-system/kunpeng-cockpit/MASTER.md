# 设计系统 MASTER

**风格**: 极简主义 Minimalism
**配色**: primary #EA580C · secondary #F97316 · CTA #EA580C
**字体**: Lora / Source Sans 3
**备注**: 鲲鹏 cockpit:橙色品牌不变,极简专业,反AI味宪法

## 反模式(必避)
- 禁紫蓝渐变/cyan-on-dark/处处霓虹
- 禁 emoji 当图标,强制 SVG(Heroicons/Lucide)
- 禁默认退回 Inter/Roboto/Arial,必须指定字体配对
- 动效 150–300ms,禁 0ms 瞬变、禁 >500ms
- 禁卡片套卡片(三层容器)
- 禁无意义全局模糊
- 禁'大数字+小标签+渐变线'的套路 Hero 指标
- 文案禁 Empower/Unlock/Transform 开头,至少一处带具体数字
- 禁删 focus ring;禁纯 hover 交互;触控≥44px;对比≥WCAG AA
