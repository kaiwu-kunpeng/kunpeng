// 把 DEFINE 产物推导成设计 loop 的结构化 BRIEF。纯函数。所有必填字段保底非空，tone 避开被禁空词。
import type { DesignBrief } from "../design/brief-gate.js";
import type { ProductDefinition } from "./contract.js";

export function specToBrief(def: ProductDefinition): DesignBrief {
  const users = def.users.filter(Boolean);
  const stories = def.stories.filter(Boolean);
  return {
    projectType: def.idea.trim() || "产品页面",
    audience: users.join("、") || "目标用户",
    primaryGoal: stories[0] ?? (def.problem.trim() || "完成核心任务"),
    tone: def.jobStatement?.trim()
      ? `以任务为中心：${def.jobStatement.trim()}`
      : "克制、专业、以任务为中心",
    mustHave: stories.length ? stories.slice(0, 5) : ["核心信息一屏可达"],
    forbidden: (def.nonGoals ?? []).filter(Boolean).slice(0, 5).length
      ? (def.nonGoals ?? []).filter(Boolean).slice(0, 5)
      : ["紫渐变", "AI 默认审美"],
    techStack: "TypeScript + 原生 HTML/CSS",
    locale: "zh",
    successMetric: def.acceptance.filter(Boolean)[0] ?? "用户能完成核心任务",
  };
}
