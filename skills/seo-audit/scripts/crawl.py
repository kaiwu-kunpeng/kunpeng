#!/usr/bin/env python3
"""补充抓取：先从首页顺链接广度优先抓完（source=link），再补抓 sitemap 里没到过的 URL（source=sitemap-only）。
每个 HTML 落盘 full/html/*.html.gz，逐页字段写 full/pages.jsonl，sitemap 清单写 full/sitemap-urls.json。

用法：python3 crawl.py --config full/audit.json
sitemap 自动发现：配置 crawl.sitemaps > robots.txt 的 Sitemap: 行 > /sitemap.xml、/sitemap_index.xml、/wp-sitemap.xml；索引递归展开，支持 .gz。
依赖：beautifulsoup4（lxml 可选）。遵守 robots.txt 的 Disallow（User-agent: * 组）。
"""
import argparse, gzip, json, os, re, sys, threading, time, urllib.error, urllib.parse, urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cfg

ap = argparse.ArgumentParser(); ap.add_argument("--config", required=True); a = ap.parse_args()
C = _cfg.load(a.config); O, HOST = C["_origin"], C["_host"]
CR = C.get("crawl", {}); MAXN = CR.get("max_pages", 6000); CONC = CR.get("concurrency", 6)
SKIP_PATH = tuple(CR.get("skip_paths", []))
UA = "kunpeng-seo/0.1"
PARSER = "lxml"
try: BeautifulSoup("<p>", "lxml")
except Exception: PARSER = "html.parser"
os.makedirs(os.path.join(C["_dir"], "html"), exist_ok=True)
SKIP_EXT = re.compile(r"\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|zip|rar|mp4|mov|webm|xlsx?|docx?|pptx?|css|js|json|xml|txt|dwg|step|stp)$", re.I)
CJK = re.compile(r"[぀-ヿ㐀-鿿가-힯฀-๿]")


def get(url, timeout=40, tries=3):
    safe = urllib.parse.quote(url, safe=":/?&=%#+,;@!$'()*~"); t0 = time.time(); err = ""
    for i in range(tries):
        try:
            r = urllib.request.urlopen(urllib.request.Request(safe, headers={"User-Agent": UA}), timeout=timeout)
            return r.status, r.url, r.headers, r.read(), time.time() - t0
        except urllib.error.HTTPError as e:
            return e.code, url, e.headers, e.read() if e.fp else b"", time.time() - t0
        except Exception as e:
            err = f"{type(e).__name__}: {e}"; time.sleep(2 * (i + 1))
    return 0, url, {"x-err": err[:200]}, err.encode(), time.time() - t0


# robots：只取 User-agent: * 组的 Disallow
_, _, _, rb, _ = get(O + "/robots.txt"); rtxt = rb.decode("utf-8", "replace")
DIS, grp, SM_ROBOTS = [], False, []
for l in rtxt.splitlines():
    k, _, v = l.partition(":"); k, v = k.strip().lower(), v.strip()
    if k == "user-agent": grp = (v == "*")
    elif k == "disallow" and grp and v: DIS.append(v)
    elif k == "sitemap" and v: SM_ROBOTS.append(v)


def disallowed(path): return any(re.match("^" + re.escape(d).replace(r"\*", ".*"), path) for d in DIS)


def same_site(h): return h and h.removeprefix("www.") == HOST.removeprefix("www.")


def norm(href, base):
    if not href: return None
    href = href.strip()
    if href.startswith(("mailto:", "tel:", "javascript:", "#", "data:")): return None
    p = urllib.parse.urlsplit(urllib.parse.urljoin(base, href))
    if p.scheme not in ("http", "https") or not same_site(p.hostname): return None
    return urllib.parse.urlunsplit((urllib.parse.urlsplit(O).scheme, HOST, urllib.parse.unquote(p.path or "/"), p.query, ""))


def crawlable(u):
    p = urllib.parse.urlsplit(u)
    return not (SKIP_EXT.search(p.path) or p.path.startswith(SKIP_PATH) or disallowed(p.path + ("?" + p.query if p.query else "")))


def extract(url, final, status, headers, body, secs):
    rec = {"url": url, "final": final, "status": status, "secs": round(secs, 3), "bytes": len(body), "ctype": (headers.get("content-type") or "") if headers else ""}
    if status == 0: rec["err"] = headers.get("x-err")
    if status != 200 or "html" not in rec["ctype"]: return rec, []
    h = body.decode("utf-8", "replace")
    with gzip.open(_cfg.html_file(C, url), "wt", encoding="utf-8") as f: f.write(h)
    s = BeautifulSoup(h, PARSER)
    meta = lambda **kw: (s.find("meta", attrs=kw) or {}).get("content")
    rec.update(title=s.title.get_text() if s.title else None, desc=meta(name="description"), robots=meta(name="robots"), ogImage=meta(property="og:image"))
    c = s.find("link", rel="canonical"); rec["canonical"] = c.get("href") if c else None
    rec["lang"] = s.html.get("lang") if s.html else None
    # hreflang 属性大小写不一（Next.js 输出 hrefLang），BeautifulSoup 统一转小写，这里用小写键
    rec["hreflang"] = [[l.get("hreflang"), l.get("href")] for l in s.find_all("link") if l.get("hreflang")]
    rec["h1"] = len(s.find_all("h1"))
    types = []
    for sc in s.find_all("script", type="application/ld+json"):
        try: data = json.loads(sc.string or "")
        except Exception: types.append("__invalid__"); continue
        st = [data]
        while st:
            x = st.pop()
            if isinstance(x, list): st += x
            elif isinstance(x, dict):
                t = x.get("@type")
                if t: types += t if isinstance(t, list) else [t]
                st += [v for v in x.values() if isinstance(v, (dict, list))]
    rec["jsonld"] = types
    imgs = s.find_all("img")
    rec["img"] = {"total": len(imgs), "noAlt": sum(1 for i in imgs if not (i.get("alt") or "").strip()),
                  "lazy": sum(1 for i in imgs if i.get("loading") == "lazy"),
                  "modern": sum(1 for i in imgs if re.search(r"\.(webp|avif)(\?|$)", i.get("src") or i.get("data-src") or "", re.I)),
                  "noDims": sum(1 for i in imgs if not (i.get("width") and i.get("height")))}
    rec["scripts"] = len(s.find_all("script"))
    rec["thirdPartyScripts"] = sorted({urllib.parse.urlsplit(urllib.parse.urljoin(url, x["src"])).hostname or "" for x in s.find_all("script", src=True)} - {HOST, ""})
    links = sorted({n for x in s.find_all("a", href=True) if (n := norm(x["href"], final))})
    for t in s(["script", "style", "noscript"]): t.decompose()
    text = s.get_text(" ")
    rec["words"] = len(CJK.sub(" ", text).split()) + len(CJK.findall(text))  # 中日韩泰按字计，避免空格分词误报
    rec["outlinks"] = links
    return rec, links


seen, lock = {}, threading.Lock()
out = open(os.path.join(C["_dir"], "pages.jsonl"), "w")


def fetch(u, depth, src):
    st, fin, hd, body, secs = get(u)
    rec, links = extract(u, fin, st, hd, body, secs); rec["depth"], rec["source"] = depth, src
    with lock: out.write(json.dumps(rec, ensure_ascii=False) + "\n"); out.flush()
    return links + ([n] if fin != u and (n := norm(fin, u)) else [])


q = deque([(O + "/", 0)]); seen[O + "/"] = 0
with ThreadPoolExecutor(CONC) as ex:
    while q and len(seen) < MAXN:
        batch = [q.popleft() for _ in range(min(CONC * 4, len(q)))]
        for (u, d), links in zip(batch, ex.map(lambda x: fetch(x[0], x[1], "link"), batch)):
            for l in links:
                if l not in seen and crawlable(l): seen[l] = d + 1; q.append((l, d + 1))
        print(f"[link] seen={len(seen)} queue={len(q)}", file=sys.stderr, flush=True)


def sitemap_urls():
    cands = CR.get("sitemaps") or SM_ROBOTS or [O + "/sitemap.xml", O + "/sitemap_index.xml", O + "/wp-sitemap.xml"]
    todo, done, urls = list(cands), set(), []
    while todo:
        sm = todo.pop(0)
        if sm in done: continue
        done.add(sm); st, _, _, body, _ = get(sm)
        if st != 200: continue
        if sm.endswith(".gz"):
            try: body = gzip.decompress(body)
            except Exception: pass
        x = body.decode("utf-8", "replace"); locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", x)
        if "<sitemapindex" in x: todo += locs
        else: urls += locs
    return [u for u in dict.fromkeys(urls) if same_site(urllib.parse.urlsplit(u).hostname) and not SKIP_EXT.search(urllib.parse.urlsplit(u).path)]


sm = sitemap_urls(); json.dump(sm, open(os.path.join(C["_dir"], "sitemap-urls.json"), "w"))
missing = [u for u in sm if norm(u, O) not in seen]
print("sitemap", len(sm), "链接未到达", len(missing), file=sys.stderr)
with ThreadPoolExecutor(CONC) as ex:
    for u in missing: seen[norm(u, O)] = -1
    list(ex.map(lambda u: fetch(norm(u, O), -1, "sitemap-only"), missing))
out.close()
print("完成", len(seen), "个 URL；pages.jsonl、sitemap-urls.json、html/ 已落盘", file=sys.stderr)
