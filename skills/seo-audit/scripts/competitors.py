#!/usr/bin/env python3
"""竞品首页单次实测：状态、TTFB（单次）、压缩、缓存头、hreflang 条数、x-default、lang、标题、canonical、结构化数据类型（全部，不截断）。

用法：python3 competitors.py --config full/audit.json
配置：competitors = {"名称": "首页 URL"}，被审站自己会自动加进第一行。输出 full/competitors.json。
每个站用独立的临时文件并在请求前清空，避免一个站失败时沿用上一站的内容。
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile
from bs4 import BeautifulSoup
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cfg

ap = argparse.ArgumentParser(); ap.add_argument("--config", required=True); a = ap.parse_args()
C = _cfg.load(a.config)
SITES = {C.get("site_name", C["_domain"]): C["_origin"] + "/", **C.get("competitors", {})}
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36"
tmp = tempfile.mkdtemp(); out = {}
for i, (name, u) in enumerate(SITES.items()):
    hf, bf = os.path.join(tmp, f"{i}.h"), os.path.join(tmp, f"{i}.b")
    for f in (hf, bf): open(f, "w").close()
    r = subprocess.run(["curl", "-sSL", "-m", "40", "-A", UA, "--compressed", "-D", hf, "-o", bf, "-w", "%{http_code} %{time_starttransfer} %{url_effective}", u],
                       capture_output=True, text=True).stdout.split()
    status = r[0] if r else "000"
    if status != "200":
        out[name] = {"url": u, "status": status, "note": "拒绝访问" if status == "403" else "未能访问" if status == "000" else f"HTTP {status}"}; continue
    hd = open(hf, errors="replace").read().lower(); s = BeautifulSoup(open(bf, errors="replace").read(), "html.parser")
    types = set()
    for sc in s.find_all("script", type="application/ld+json"): types |= set(re.findall(r'"@type"\s*:\s*"([^"]+)"', sc.string or ""))
    enc = re.findall(r"content-encoding:\s*(\S+)", hd); cache = re.findall(r"(x-cache|cf-cache-status|x-nextjs-cache|x-vercel-cache):\s*([^\n]+)", hd)
    alts = [l for l in s.find_all("link") if l.get("hreflang")]
    c = s.find("link", rel="canonical")
    out[name] = {"url": u, "status": status, "final": r[2] if len(r) > 2 else u, "ttfb": float(r[1]) if len(r) > 1 else None,
                 "title": s.title.get_text().strip() if s.title else "", "lang": s.html.get("lang") if s.html else None,
                 "hreflang": len(alts), "xdefault": any(l.get("hreflang") == "x-default" for l in alts), "canonical": c.get("href") if c else None,
                 "jsonld": sorted(types), "encoding": enc[-1] if enc else "", "cache": f"{cache[-1][0]}: {cache[-1][1].strip()}" if cache else ""}
shutil.rmtree(tmp)
json.dump(out, open(os.path.join(C["_dir"], "competitors.json"), "w"), ensure_ascii=False, indent=1)
for k, v in out.items(): print(k, {x: v.get(x) for x in ("status", "ttfb", "encoding", "cache", "hreflang", "lang", "title")})
