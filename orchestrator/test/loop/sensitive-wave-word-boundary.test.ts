import { describe, it, expect } from "vitest";
import { guardWave, isSensitiveWave } from "../../src/loop/ops-guard.js";

describe("内容里出现 pay/charge 的词不再算敏感动作", () => {
  it("Alipay 是产品名，不是付款动作", () => {
    expect(isSensitiveWave("Alipay 绑外卡被拒页补条号层")).toBe(false);
  });

  it("/payments 是路由路径，不是付款动作", () => {
    expect(isSensitiveWave("/payments 下对应那一页")).toBe(false);
  });

  it("recharge 与 charger 不是扣费动作", () => {
    expect(isSensitiveWave("充电宝 recharge 与 charger 说明页")).toBe(false);
  });

  it("Alipay 与 payments 同现也不命中", () => {
    expect(isSensitiveWave("Alipay、payments 路由族的对比表")).toBe(false);
  });
});

describe("真的付款/扣费措辞仍然拦住", () => {
  it("pay 作为动词", () => {
    expect(isSensitiveWave("这一波要 pay 一笔")).toBe(true);
  });

  it("payment 单数", () => {
    expect(isSensitiveWave("发起 payment 给供应商")).toBe(true);
  });

  it("charge 及其变形", () => {
    expect(isSensitiveWave("会被 charge 一笔费用")).toBe(true);
    expect(isSensitiveWave("已经 charged 过了")).toBe(true);
    expect(isSensitiveWave("多笔 charges 已入账")).toBe(true);
    expect(isSensitiveWave("正在 charging 用户")).toBe(true);
  });

  it("WeChat Pay 是已知残留:仍然命中,不许加品牌特例去绕", () => {
    expect(isSensitiveWave("补 WeChat Pay 与 Alipay 的对比表")).toBe(true);
  });

  it("中文付费/付款一字不减", () => {
    expect(isSensitiveWave("升级付费套餐")).toBe(true);
    expect(isSensitiveWave("走付款流程")).toBe(true);
  });
});

describe("其余四条规则不受本次改动影响", () => {
  it("部署 / production", () => {
    expect(isSensitiveWave("部署到 production")).toBe(true);
    expect(isSensitiveWave("publish 到线上")).toBe(true);
  });

  it("删除 / 清空", () => {
    expect(isSensitiveWave("执行 rm -rf 清理")).toBe(true);
    expect(isSensitiveWave("清空这张表")).toBe(true);
  });

  it("凭证 / credential / secret", () => {
    expect(isSensitiveWave("轮换 credential")).toBe(true);
    expect(isSensitiveWave("更新 secret")).toBe(true);
  });

  it("普通内容波仍然不敏感", () => {
    expect(isSensitiveWave("补充品类内容页")).toBe(false);
  });
});

describe("guardWave 的判决形状不变", () => {
  const base = { actions: [], loopId: "l1", observational: false, tokensSpent30d: 0 };

  it("敏感命中仍是 allow:false / kind:sensitive", () => {
    const v = guardWave({ ...base, waveText: "这一波要 pay 一笔" });
    expect(v.allow).toBe(false);
    expect(v.kind).toBe("sensitive");
  });

  it("Alipay 内容波现在放行", () => {
    const v = guardWave({ ...base, waveText: "Alipay 绑外卡被拒页补条号层" });
    expect(v.allow).toBe(true);
    expect(v.kind).toBeUndefined();
  });
});