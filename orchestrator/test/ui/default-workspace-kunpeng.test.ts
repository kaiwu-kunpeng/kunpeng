import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

/** 从拼好的浏览器脚本里抠出常量 + currentProjectId 函数体，注入假 window/latestState 真跑一遍。 */
function currentProjectIdWith(hash: string, projects: Array<{ id: string }>): string {
  const matched = /var KP_SELF_PROJECT_ID[\s\S]*?function currentProjectId\(\)[\s\S]*?\n {2}\}/.exec(clientScript);
  if (!matched) throw new Error("clientScript 里找不到 KP_SELF_PROJECT_ID + currentProjectId");
  const fn = new Function("window", "latestState", matched[0] + "\nreturn currentProjectId();");
  return fn({ location: { hash } }, { projects }) as string;
}

const REGISTRY = [{ id: "acme-shop" }, { id: "acme-tools" }, { id: "kunpeng" }];

describe("默认工作区 = 鲲鹏本体", () => {
  test("clientScript 语法有效(防 SPA 整页崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("终端路由无项目段 → 取 kunpeng,不是注册表第一个项目", () => {
    expect(currentProjectIdWith("#/terminal", REGISTRY)).toBe("kunpeng");
  });

  test("工作台等其它无项目段路由同样取 kunpeng", () => {
    expect(currentProjectIdWith("#/workbench", REGISTRY)).toBe("kunpeng");
  });

  test("项目路由优先,不被默认值覆盖", () => {
    expect(currentProjectIdWith("#/project/acme-tools/flows", REGISTRY)).toBe("acme-tools");
  });

  test("注册表里没有 kunpeng → 退回第一个项目", () => {
    expect(currentProjectIdWith("#/terminal", [{ id: "acme-shop" }, { id: "acme-tools" }])).toBe("acme-shop");
  });

  test("状态未加载(项目列表为空) → 退回 current", () => {
    expect(currentProjectIdWith("#/terminal", [])).toBe("current");
  });
});