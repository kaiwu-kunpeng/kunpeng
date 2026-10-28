#!/usr/bin/env python3
"""真实用户速度（CrUX，手机/桌面 p75）+ PSI 手机实验室数据，按域名和逐 URL。

用法：python3 cwv_batch.py --config full/audit.json（读 cwv_urls）；或 --origin <站点> --urls urls.txt --out <目录>
urls.txt 每行一个 URL（通常是各语种首页 + 产品列表页 + 几个关键模板页）。
key：环境变量 GOOGLE_API_KEY，或 ~/.kunpeng/seo-keys.env 的 GOOGLE_API_KEY=（需启用 PageSpeed Insights API 与 Chrome UX Report API）。
CrUX 返回 404 = 该 URL 真实用户样本不足，报告里写「样本不足」，不是错误。输出 <out>/cwv-batch.json。
"""
import argparse, concurrent.futures as cf, json, os, sys, time, urllib.error, urllib.parse, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--config"); ap.add_argument("--origin"); ap.add_argument("--urls"); ap.add_argument("--out")
a = ap.parse_args()
URLS = None
if a.config:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import _cfg
    _C = _cfg.load(a.config); a.origin = a.origin or _C["_origin"]; a.out = a.out or _C["_dir"]
    URLS = [_cfg.abs_url(_C, u) for u in _C.get("cwv_urls", [])]
if not (a.origin and a.out and (URLS or a.urls)): sys.exit("需要 --config，或 --origin --urls --out")


def key():
    if os.environ.get("GOOGLE_API_KEY"): return os.environ["GOOGLE_API_KEY"]
    p = os.path.expanduser("~/.kunpeng/seo-keys.env")
    for l in (open(p) if os.path.exists(p) else []):
        if l.startswith("GOOGLE_API_KEY="): return l.strip().split("=", 1)[1]
    sys.exit("缺 GOOGLE_API_KEY：写进 ~/.kunpeng/seo-keys.env（GOOGLE_API_KEY=…）或设环境变量")


K = key()
M = {"largest_contentful_paint": "LCP", "interaction_to_next_paint": "INP", "cumulative_layout_shift": "CLS", "experimental_time_to_first_byte": "TTFB"}


def crux(body):
    req = urllib.request.Request(f"https://chromeuxreport.googleapis.com/v1/records:queryRecord?key={K}", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    err = ""
    for _ in range(3):
        try:
            m = json.load(urllib.request.urlopen(req, timeout=30))["record"]["metrics"]
            return {v: float(m[k]["percentiles"]["p75"]) for k, v in M.items() if k in m}
        except urllib.error.HTTPError as ex:
            return {"error": ex.code}
        except Exception as ex:
            err = str(ex); time.sleep(3)
    return {"error": err}


def psi(url):
    q = urllib.parse.urlencode({"url": url, "strategy": "mobile", "category": "performance", "key": K}); err = ""
    for _ in range(2):
        try:
            d = json.load(urllib.request.urlopen(f"https://www.googleapis.com/pagespeedonline/v5/runPagespeed?{q}", timeout=150))
            au = d["lighthouseResult"]["audits"]
            # 只收真正的优化机会（score < 1），通过项的标题（如 "...was short"）不算
            opps = sorted(((x["title"], x["details"].get("overallSavingsMs", 0)) for x in au.values()
                           if x.get("details", {}).get("type") == "opportunity" and (x.get("score") or 0) < 1 and x["details"].get("overallSavingsMs", 0) > 300), key=lambda t: -t[1])[:3]
            return {"score": round(d["lighthouseResult"]["categories"]["performance"]["score"] * 100), "LCP": au["largest-contentful-paint"]["numericValue"],
                    "TBT": au["total-blocking-time"]["numericValue"], "CLS": au["cumulative-layout-shift"]["numericValue"], "bytes": au["total-byte-weight"]["numericValue"],
                    "opps": [[t, round(ms)] for t, ms in opps]}
        except Exception as ex:
            err = str(ex); time.sleep(5)
    return {"error": err}


urls = URLS or [l.strip() for l in open(a.urls) if l.strip()]
with cf.ThreadPoolExecutor(4) as ex:
    pages = list(ex.map(lambda u: {"url": u, "phone": crux({"url": u, "formFactor": "PHONE"}), "desktop": crux({"url": u, "formFactor": "DESKTOP"}), "lab": psi(u)}, urls))
out = {"date": time.strftime("%Y-%m-%d"), "origin": {"phone": crux({"origin": a.origin, "formFactor": "PHONE"}), "desktop": crux({"origin": a.origin, "formFactor": "DESKTOP"})}, "pages": pages}
json.dump(out, open(os.path.join(a.out, "cwv-batch.json"), "w"), ensure_ascii=False, indent=1)
print("页面", len(pages), "有真实用户样本", sum(1 for p in pages if "error" not in p["phone"]), "PSI 成功", sum(1 for p in pages if "error" not in p["lab"]))
