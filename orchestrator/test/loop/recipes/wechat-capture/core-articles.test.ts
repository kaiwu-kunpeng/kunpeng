import { describe, expect, test } from "vitest";
import { parseGeneralMsgList } from "../../../../src/loop/recipes/wechat-capture/core.js";

// Real payload captured 2026-07-12 from a self-hosted wechat-article-exporter
// open API (/api/public/v1/article), trimmed to the fields that matter.
const REAL_ARTICLES_RESPONSE = JSON.stringify({
  base_resp: { err_msg: "ok", ret: 0 },
  articles: [
    {
      aid: "2651357747_1",
      title: "来江西，共赴八大山人笔下的艺术世界！",
      link: "https://mp.weixin.qq.com/s/0Y3eUXFVzCM3bMsTkhz9rA",
      digest: "“高山仰止 墨染千秋——八大山人诞辰400周年特展”开幕",
      author_name: "",
      create_time: 1783674660,
      update_time: 1783674660,
      is_deleted: false,
      itemidx: 1,
      appmsgid: 2651357747,
    },
    {
      aid: "2651357747_2",
      title: "来上海，共赏故宫织绣服饰之美！",
      link: "https://mp.weixin.qq.com/s/_KWGNqPlB1ak9FOlGl4rDg",
      digest: "“国采——故宫藏清代帝后服饰展”开幕",
      author_name: "故宫博物院",
      create_time: 1783674660,
      update_time: 1783674660,
      is_deleted: false,
      itemidx: 2,
      appmsgid: 2651357747,
    },
    {
      aid: "9999999_1",
      title: "已删除的文章",
      link: "https://mp.weixin.qq.com/s/deleted-should-skip",
      is_deleted: true,
      create_time: 1783674660,
    },
    {
      aid: "8888888_1",
      title: "没有链接的坏条目",
      link: "",
      create_time: 1783674660,
    },
  ],
});

describe("parseGeneralMsgList: self-hosted exporter {articles:[]} shape", () => {
  test("parses real open-API payload: keeps live articles, skips deleted and linkless", () => {
    const articles = parseGeneralMsgList(REAL_ARTICLES_RESPONSE);
    expect(articles).toHaveLength(2);

    expect(articles[0].title).toBe("来江西，共赴八大山人笔下的艺术世界！");
    expect(articles[0].url).toBe("https://mp.weixin.qq.com/s/0Y3eUXFVzCM3bMsTkhz9rA");
    expect(articles[0].id).toBeTruthy();
    expect(articles[0].publishedAt).toBe(1783674660);
    expect(articles[0].author).toBeUndefined();
    expect(articles[0].digest).toContain("八大山人诞辰400周年");

    expect(articles[1].author).toBe("故宫博物院");
    expect(articles[1].url).toBe("https://mp.weixin.qq.com/s/_KWGNqPlB1ak9FOlGl4rDg");
  });

  test("ids from the two live articles are distinct (dedup key sanity)", () => {
    const articles = parseGeneralMsgList(REAL_ARTICLES_RESPONSE);
    expect(new Set(articles.map((a) => a.id)).size).toBe(2);
  });

  test("legacy general_msg_list shape still parses (regression)", () => {
    const legacy = JSON.stringify({
      list: [
        {
          comm_msg_info: { datetime: 1700000000 },
          app_msg_ext_info: {
            title: "老形状文章",
            content_url: "https://mp.weixin.qq.com/s/legacy-one&amp;x=1",
            is_multi: 0,
          },
        },
      ],
    });
    const articles = parseGeneralMsgList(legacy);
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe("老形状文章");
    expect(articles[0].url).toBe("https://mp.weixin.qq.com/s/legacy-one&x=1");
  });

  test("neither shape present returns empty, not throw", () => {
    expect(parseGeneralMsgList("{}")).toEqual([]);
    expect(parseGeneralMsgList("not json")).toEqual([]);
    expect(parseGeneralMsgList(JSON.stringify({ articles: "nope" }))).toEqual([]);
  });
});