import { describe, it, expect } from "vitest";
import { guardWave, isSensitiveWave } from "../../src/loop/ops-guard.js";

describe("kebab-case 标识符与路径不是付款动作", () => {
  it("波次说明里引用文件名不再命中", () => {
    expect(
      isSensitiveWave("本仓 lib/data/metro-payment-rules.ts 已用过同一文件的另一面"),
    ).toBe(false);
  });

  it("裸文件名", () => {
    expect(isSensitiveWave("cash-payment-rules.ts")).toBe(false);
  });

  it("路由路径", () => {
    expect(isSensitiveWave("/payments 路由族")).toBe(false);
  });

  it("上一轮修掉的子串误报不回退", () => {
    expect(isSensitiveWave("Alipay 绑外卡被拒页补条号层")).toBe(false);
    expect(isSensitiveWave("充电宝 recharge 与 charger 说明页")).toBe(false);
  });
});

describe("真的付款/扣费措辞仍然拦住", () => {
  it("pay / payment 独立成词", () => {
    expect(isSensitiveWave("这一波要 pay 一笔")).toBe(true);
    expect(isSensitiveWave("发起 payment 给供应商")).toBe(true);
  });

  it("charge 四种变形", () => {
    expect(isSensitiveWave("会被 charge 一笔费用")).toBe(true);
    expect(isSensitiveWave("已经 charged 过了")).toBe(true);
    expect(isSensitiveWave("多笔 charges 已入账")).toBe(true);
    expect(isSensitiveWave("正在 charging 用户")).toBe(true);
  });

  it("中文一字不减", () => {
    expect(isSensitiveWave("升级付费套餐")).toBe(true);
    expect(isSensitiveWave("走付款流程")).toBe(true);
  });
});

describe("反向护栏:没有对输入做全局剥离", () => {
  it("带连字符的部署动作必须继续被拦", () => {
    expect(isSensitiveWave("auto-deploy-prod 流程")).toBe(true);
  });

  it("带连字符的删除动作必须继续被拦", () => {
    expect(isSensitiveWave("跑 drop-table-users 脚本")).toBe(true);
  });

  it("其余四条一如既往", () => {
    expect(isSensitiveWave("部署到 production")).toBe(true);
    expect(isSensitiveWave("执行 rm -rf 清理")).toBe(true);
    expect(isSensitiveWave("轮换 credential")).toBe(true);
    expect(isSensitiveWave("补充品类内容页")).toBe(false);
  });
});

describe("guardWave 判决形状不变", () => {
  const base = { actions: [], loopId: "l1", observational: false, tokensSpent30d: 0 };

  it("敏感命中仍是 allow:false / kind:sensitive", () => {
    const v = guardWave({ ...base, waveText: "这一波要 pay 一笔" });
    expect(v.allow).toBe(false);
    expect(v.kind).toBe("sensitive");
  });

  it("引用了 payment 文件名的内容波现在放行", () => {
    const v = guardWave({
      ...base,
      waveText: "本仓 lib/data/metro-payment-rules.ts 已用过同一文件的另一面",
    });
    expect(v.allow).toBe(true);
    expect(v.kind).toBeUndefined();
  });
});