import { describe, expect, it } from "vitest";
import {
  dedupNewNotices,
  extractNotices,
  noticeIdFromUrl,
  normalizeDate,
  summarizeSiteWave,
  type SiteCaptureTarget,
} from "../../../../src/loop/recipes/site-capture/core.js";

function target(listUrl: string, extra: Partial<SiteCaptureTarget> = {}): SiteCaptureTarget {
  return { name: "甲机构", listUrl, ...extra };
}

describe("site-capture · 日期规范化", () => {
  it("四种常见写法都归一成 YYYY-MM-DD", () => {
    expect(normalizeDate("2026-08-28")).toBe("2026-08-28");
    expect(normalizeDate("2026 / 08 / 27")).toBe("2026-08-27");
    expect(normalizeDate("2026.8.6")).toBe("2026-08-06");
    expect(normalizeDate("发布于 2026年9月1日 10:00")).toBe("2026-09-01");
  });

  it("没有日期返回 undefined", () => {
    expect(normalizeDate("昨天")).toBeUndefined();
    expect(normalizeDate("")).toBeUndefined();
  });
});

describe("site-capture · 九种列表结构都能抽出 标题/绝对URL/日期", () => {
  it("A 相对路径 ../../ + <span>日期 (置顶旧条排最后)", () => {
    const html = `<div class="list_bd"><ul>
      <li><a href="../../n1/n2/c9999/content.html">甲机构关于增加过境免签适用国家的公告</a><span>2026-08-28</span></li>
      <li><a href="../../n1/n2/c1000/content.html">口岸签证机关联系方式一览表</a><span>2024-01-05</span></li>
    </ul></div>`;
    const out = extractNotices(html, target("https://www.example-a.gov.cn/n1/n2/index.html"));
    expect(out.map((n) => n.url)).toEqual([
      "https://www.example-a.gov.cn/n1/n2/c9999/content.html",
      "https://www.example-a.gov.cn/n1/n2/c1000/content.html",
    ]);
    expect(out[0]?.title).toBe("甲机构关于增加过境免签适用国家的公告");
    expect(out[0]?.date).toBe("2026-08-28");
    expect(out[1]?.date).toBe("2024-01-05");
  });

  it("B 相对路径 ./ + title 属性 + <em>带换行的日期 + titleInclude 过滤", () => {
    const html = `<div class="main_directory_list"><ul>
      <li><i></i><a href="./202607/t1.html" title="市公安局出入境管理局关于接待大厅迁址的通告"><span>市公安局出入境管理局关于接待大厅迁址的通告</span></a><em>
        2026-07-15
      </em></li>
      <li><i></i><a href="./202606/t2.html"><span>关于律师会见预约平台暂停服务的公告</span></a><em>2026-06-09</em></li>
    </ul></div>`;
    const out = extractNotices(html, target("https://www.example-b.gov.cn/xxfb/tzgg/index.html", { titleInclude: "出入境" }));
    expect(out).toHaveLength(1);
    expect(out[0]?.url).toBe("https://www.example-b.gov.cn/xxfb/tzgg/202607/t1.html");
    expect(out[0]?.date).toBe("2026-07-15");
  });

  it("C 日期在 <a> 内部,格式 2026 / 08 / 27,标题需剥掉日期与尾随空白", () => {
    const html = `<div id="datalist"><div class="li">
      <a href="/announce_detail/379516.html"><div class="p">关于延禧宫暂停开放的公告 </div><div class="y">2026 / 08 / 27</div></a>
      <div class="desc">摘要文字</div></div></div>`;
    const out = extractNotices(html, target("https://www.example-c.org.cn/announce.html"));
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("关于延禧宫暂停开放的公告");
    expect(out[0]?.url).toBe("https://www.example-c.org.cn/announce_detail/379516.html");
    expect(out[0]?.date).toBe("2026-08-27");
  });

  it("C2 标题自带日期时保留标题原文,发布日期仍取独立的日期节点", () => {
    const html = `<div class="li"><a href="/announce_detail/379398.html"><div class="p">博物院关于2026年10月1日开放安排的公告</div><div class="y">2026 / 07 / 27</div></a></div>`;
    const out = extractNotices(html, target("https://www.example-c.org.cn/announce.html"));
    expect(out[0]?.title).toBe("博物院关于2026年10月1日开放安排的公告");
    expect(out[0]?.date).toBe("2026-07-27");
  });

  it("D 点号日期 2026.08.26 + 目录型 listUrl 的 ./ 相对路径", () => {
    const html = `<ul class="xly_list_ts"><li><div class="text_w">
      <a class="titles" href="./202608/t20260826_1.shtml" title="博物馆2026年度社会招聘入围考察人员信息公告">博物馆2026年度社会招聘入围考察人员信息公告</a>
      <p class="texts"></p><div class="times"><span class="sp">2026.08.26</span></div></div></li></ul>`;
    const out = extractNotices(html, target("https://www.example-d.cn/gbgg/"));
    expect(out).toHaveLength(1);
    expect(out[0]?.url).toBe("https://www.example-d.cn/gbgg/202608/t20260826_1.shtml");
    expect(out[0]?.date).toBe("2026-08-26");
  });

  it("E 图片锚点与标题锚点指向同一 URL 只出一条", () => {
    const html = `<div class="imglist"><div class="item">
      <div class="img"><a href="/news/list_1/3344.html"><img src="/x.jpg"></a></div>
      <div class="text"><div class="tit1"><a href="/news/list_1/3344.html">关于进一步加强博物馆陈列展览内容审核工作的通知</a></div><div class="date1">2026-08-20</div></div>
    </div></div>`;
    const out = extractNotices(html, target("https://www.example-e.com.cn/news/list_1.html"));
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("关于进一步加强博物馆陈列展览内容审核工作的通知");
    expect(out[0]?.date).toBe("2026-08-20");
  });

  it("F 空锚点 + 标题在后方 span + 日期拆成 <span>MM-DD</span>YYYY 且在锚点之前", () => {
    const html = `<ul class="ny-newsList"><li class="titlin_r">
      <time class="time"><span>09-11</span>2026</time>
      <a href="../info/1020/7894.htm" class="ablink"></a>
      <div class="info"><h4 class="title"><span class="titline_r">研究院2026年高层次人才引进补充公告</span></h4><p class="desc">摘要里也有 <a href="../info/1020/1.htm">链接</a></p></div>
    </li></ul>`;
    const out = extractNotices(html, target("https://www.example-f.ac.cn/xwzx/tzgg.htm"));
    expect(out[0]?.url).toBe("https://www.example-f.ac.cn/info/1020/7894.htm");
    expect(out[0]?.title).toBe("研究院2026年高层次人才引进补充公告");
    expect(out[0]?.date).toBe("2026-09-11");
  });

  it("G 根相对路径 + <span class=time>", () => {
    const html = `<ul class="policy-list"><li class="clearfix"><div class="policy-content">
      <h4><a href="/nw4411/20260914/abc.html" title="市对外友协走过70年">市对外友协走过70年</a></h4><span class="time">2026-09-14</span>
    </div></li></ul>`;
    const out = extractNotices(html, target("https://www.example-g.gov.cn/nw2315/index.html"));
    expect(out[0]?.url).toBe("https://www.example-g.gov.cn/nw4411/20260914/abc.html");
    expect(out[0]?.date).toBe("2026-09-14");
  });

  it("H 同一列表混用绝对 URL 与 ./ 相对路径", () => {
    const html = `<ul class="list">
      <li class="col-md"><a href="https://www.example-h.gov.cn/zhengce/202609/t1.html" title="市人民政府关于试鸣防空警报的通告">市人民政府关于试鸣防空警报的通告</a><span>2026-09-14</span></li>
      <li class="col-md"><a href="./202609/t2.html">服务贸易数字化转型跑出加速度</a><span>2026-09-13</span></li>
    </ul>`;
    const out = extractNotices(html, target("https://www.example-h.gov.cn/ywdt/yaowen/"));
    expect(out.map((n) => n.url)).toEqual([
      "https://www.example-h.gov.cn/zhengce/202609/t1.html",
      "https://www.example-h.gov.cn/ywdt/yaowen/202609/t2.html",
    ]);
  });

  it("I 标题被大量空白换行包裹 + target=_blank + ../../ 路径", () => {
    const html = `<ul class="mesgopen2"><li><b class="point">·</b><a href="../../wysy/202609/t3.html" target="_blank">
          文化和旅游部办公厅关于举办全国优秀音乐剧展演的通知
        </a><span class="date">2026-09-10</span></li></ul>`;
    const out = extractNotices(html, target("https://zwgk.example-i.gov.cn/zfxxgkml/503/510/index_3081.html"));
    expect(out[0]?.title).toBe("文化和旅游部办公厅关于举办全国优秀音乐剧展演的通知");
    expect(out[0]?.url).toBe("https://zwgk.example-i.gov.cn/zfxxgkml/wysy/202609/t3.html");
  });
});

describe("site-capture · 噪声过滤与排序", () => {
  it("导航短链接、javascript:、锚点、外站链接、无日期噪声一律不算公告", () => {
    const html = `<a href="/">首页</a><a href="#top">返回顶部返回顶部</a><a href="javascript:void(0)">更多更多更多更多更多</a>
      <a href="https://weibo.com/u/1">机构官方微博账号入口</a><script>var a = "<a href='/s/1'>脚本里的假公告假公告</a>"</script>
      <li><a href="/notice/1.html">这是一条真正的公告标题</a><span>2026-01-02</span></li>`;
    const out = extractNotices(html, target("https://www.example-n.gov.cn/notice/index.html"));
    expect(out.map((n) => n.title)).toEqual(["这是一条真正的公告标题"]);
  });

  it("按日期倒序;同一 <li> 内没有日期的链接不算公告(不许借用下一条的日期);limit 生效", () => {
    const html = `<li><a href="/n/1.html">公告一号公告一号</a><span>2026-03-01</span></li>
      <li><a href="/n/3.html">公告三号没有日期</a></li>
      <li><a href="/n/2.html">公告二号公告二号</a><span>2026-05-01</span></li>
      <li><a href="/n/4.html">公告四号公告四号</a><span>2026-04-01</span></li>`;
    const out = extractNotices(html, target("https://www.example-s.gov.cn/n/index.html"));
    expect(out.map((n) => n.url.slice(-6))).toEqual(["2.html", "4.html", "1.html"]);
    expect(extractNotices(html, target("https://www.example-s.gov.cn/n/index.html"), { limit: 2 })).toHaveLength(2);
  });

  it("urlInclude 只保留命中路径", () => {
    const html = `<li><a href="/policy/1.html">政策文件一政策文件一</a><span>2026-03-01</span></li>
      <li><a href="/news/2.html">新闻动态二新闻动态二</a><span>2026-05-01</span></li>`;
    const out = extractNotices(html, target("https://www.example-u.gov.cn/index.html", { urlInclude: "/policy/" }));
    expect(out.map((n) => n.url)).toEqual(["https://www.example-u.gov.cn/policy/1.html"]);
  });
});

describe("site-capture · id/去重/汇总", () => {
  it("noticeIdFromUrl 确定且为小写十六进制", () => {
    const a = noticeIdFromUrl("https://www.example-a.gov.cn/n/1.html");
    expect(a).toBe(noticeIdFromUrl("https://www.example-a.gov.cn/n/1.html"));
    expect(a).toMatch(/^[0-9a-f]{6,}$/);
    expect(a).not.toBe(noticeIdFromUrl("https://www.example-a.gov.cn/n/2.html"));
  });

  it("dedupNewNotices 剔除 seen 并保序", () => {
    const html = `<li><a href="/n/1.html">公告一号公告一号</a><span>2026-03-02</span></li>
      <li><a href="/n/2.html">公告二号公告二号</a><span>2026-03-01</span></li>`;
    const notices = extractNotices(html, target("https://www.example-a.gov.cn/n/index.html"));
    const fresh = dedupNewNotices(notices, [notices[0]!.id]);
    expect(fresh.map((n) => n.url)).toEqual(["https://www.example-a.gov.cn/n/2.html"]);
  });

  it("summarizeSiteWave 统计 targets/fetched/newCount/errors 与最多 5 条样本", () => {
    const t = target("https://www.example-a.gov.cn/n/index.html");
    const mk = (i: number) => ({ id: `id${i}`, title: `公告${i}`, url: `https://www.example-a.gov.cn/n/${i}.html`, date: "2026-01-01" });
    const s = summarizeSiteWave([
      { target: t, fetched: 8, captured: [mk(1), mk(2), mk(3)] },
      { target: { ...t, name: "乙机构" }, fetched: 4, captured: [mk(4), mk(5), mk(6)] },
      { target: { ...t, name: "丙机构" }, fetched: 0, captured: [], error: "HTTP 403" },
    ]);
    expect(s).toMatchObject({ targets: 3, fetched: 12, newCount: 6, errors: 1 });
    expect(s.samples).toHaveLength(5);
    expect(s.samples[0]).toBe("「公告1」甲机构");
  });
});