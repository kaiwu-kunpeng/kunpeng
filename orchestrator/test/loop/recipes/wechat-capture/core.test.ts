import { describe, it, expect } from "vitest";
import {
  buildAccountSearchUrl,
  parseAccountSearchResponse,
  parseGeneralMsgList,
  dedupNewArticles,
  articleToCapturePayload,
  summarizeCaptureWave,
  type WechatCaptureConfig,
  type WechatArticle,
} from "../../../../src/loop/recipes/wechat-capture/core.js";

const config: WechatCaptureConfig = {
  exporterBaseUrl: "http://localhost:3000/",
  targets: [{ fakeid: "BIZ1", nickname: "铁路12306" }],
  pageSize: 5,
};

describe("buildAccountSearchUrl", () => {
  it("去尾斜杠 + 编码关键字 + 默认分页", () => {
    const url = buildAccountSearchUrl(config, "铁路 12306");
    expect(url).toBe(
      "http://localhost:3000/api/public/v1/account?keyword=" +
        encodeURIComponent("铁路 12306") +
        "&begin=0&size=5",
    );
  });
  it("opts 覆盖 begin/size", () => {
    const url = buildAccountSearchUrl(config, "x", { begin: 10, size: 20 });
    expect(url).toContain("begin=10");
    expect(url).toContain("size=20");
  });
});

describe("parseAccountSearchResponse", () => {
  it("正常解析并跳过无 fakeid 项", () => {
    const text = JSON.stringify({
      base_resp: { ret: 0, err_msg: "ok" },
      list: [
        { fakeid: "A", nickname: "甲", alias: "jia" },
        { fakeid: "", nickname: "空", alias: "" },
      ],
    });
    const accounts = parseAccountSearchResponse(text);
    expect(accounts).toEqual([{ fakeid: "A", nickname: "甲", alias: "jia" }]);
  });
  it("ret 非 0 → []", () => {
    expect(parseAccountSearchResponse(JSON.stringify({ base_resp: { ret: -1 }, list: [{ fakeid: "A" }] }))).toEqual([]);
  });
  it("坏 JSON → []", () => {
    expect(parseAccountSearchResponse("not json")).toEqual([]);
  });
});

describe("parseGeneralMsgList", () => {
  const raw = JSON.stringify({
    list: [
      {
        comm_msg_info: { datetime: 1720000000 },
        app_msg_ext_info: {
          title: "主标题",
          content_url: "http://mp.weixin.qq.com/s?__biz=B&amp;mid=100&amp;idx=1&amp;sn=aa",
          digest: "摘要",
          author: "作者甲",
          del_flag: 0,
          is_multi: 1,
          multi_app_msg_item_list: [
            {
              title: "副标题",
              content_url: "http://mp.weixin.qq.com/s?__biz=B&amp;mid=100&amp;idx=2&amp;sn=bb",
              digest: "",
              author: "作者乙",
              del_flag: 0,
            },
            {
              title: "已删",
              content_url: "http://mp.weixin.qq.com/s?mid=100&idx=3",
              del_flag: 1,
            },
          ],
        },
      },
    ],
  });

  it("展开多图 + 跳过已删 + 还原实体 + id=mid_idx + 共享 publishedAt", () => {
    const arts = parseGeneralMsgList(raw);
    expect(arts.map((a) => a.id)).toEqual(["100_1", "100_2"]);
    expect(arts[0].url).toBe("http://mp.weixin.qq.com/s?__biz=B&mid=100&idx=1&sn=aa");
    expect(arts[0].title).toBe("主标题");
    expect(arts[0].publishedAt).toBe(1720000000);
    expect(arts[1].publishedAt).toBe(1720000000);
    expect(arts[1].author).toBe("作者乙");
  });

  it("坏 JSON / list 非数组 → []", () => {
    expect(parseGeneralMsgList("xxx")).toEqual([]);
    expect(parseGeneralMsgList(JSON.stringify({ list: "no" }))).toEqual([]);
  });

  it("无 mid/idx 的 url 用哈希兜底 id（稳定且非空）", () => {
    const one = JSON.stringify({
      list: [{ comm_msg_info: { datetime: 1 }, app_msg_ext_info: { title: "t", content_url: "http://x.example/no-query", del_flag: 0, is_multi: 0 } }],
    });
    const arts = parseGeneralMsgList(one);
    expect(arts.length).toBe(1);
    expect(arts[0].id.length).toBeGreaterThan(0);
    expect(arts[0].id).not.toContain("undefined");
  });
});

describe("dedupNewArticles", () => {
  const mk = (id: string): WechatArticle => ({ id, title: id, url: "u" + id });
  it("组内去重 + 剔除已见", () => {
    const out = dedupNewArticles([mk("a"), mk("b"), mk("a"), mk("c")], ["b"]);
    expect(out.map((a) => a.id)).toEqual(["a", "c"]);
  });
});

describe("articleToCapturePayload", () => {
  it("source 用 nickname，tags 去空去重", () => {
    const p = articleToCapturePayload(
      { id: "1", title: "文", url: "http://u", publishedAt: 123 },
      { fakeid: "B", nickname: "甲号" },
    );
    expect(p.source).toBe("甲号");
    expect(p.tags).toEqual(["wechat", "甲号"]);
    expect(p.url).toBe("http://u");
    expect(p.publishedAt).toBe(123);
  });
  it("无 nickname 退回 keyword，publishedAt 缺省不带", () => {
    const p = articleToCapturePayload({ id: "1", title: "文", url: "http://u" }, { keyword: "kw" });
    expect(p.source).toBe("kw");
    expect(p.publishedAt).toBeUndefined();
  });
});

describe("summarizeCaptureWave", () => {
  it("统计与样本", () => {
    const s = summarizeCaptureWave([
      { target: { nickname: "甲" }, fetched: 10, captured: [{ id: "1", title: "文章一标题", url: "u1" }] },
      { target: { keyword: "乙" }, fetched: 0, captured: [], error: "timeout" },
    ]);
    expect(s.targets).toBe(2);
    expect(s.fetched).toBe(10);
    expect(s.newCount).toBe(1);
    expect(s.errors).toBe(1);
    expect(s.samples.length).toBe(1);
    expect(s.samples[0]).toContain("文章一标题");
    expect(s.samples[0]).toContain("甲");
  });
});