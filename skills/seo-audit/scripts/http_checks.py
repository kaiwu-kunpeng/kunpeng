#!/usr/bin/env python3
"""跳转链、HTML 压缩、CDN 缓存头、单次 TTFB 抽查，落盘 full/http-checks.json（报告里的这几项必须从这个文件读，不能手抄 curl 输出）。

用法：python3 http_checks.py --config full/audit.json
配置：http_checks.redirect_starts（http://、www、裸域等入口）、http_checks.samples（抽查路径，每个请求两次看缓存是否命中）。
判定：跳转接受 301 / 308，要求一跳直达 https 主域；只抽查时报告写「抽查的页面」。不用 timeout 命令（macOS 没有），超时交给 curl -m。
"""
import argparse, json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cfg

ap = argparse.ArgumentParser(); ap.add_argument("--config", required=True); a = ap.parse_args()
C = _cfg.load(a.config); H = C.get("http_checks", {})


def curl(args): return subprocess.run(["curl", "-s", "-m", "30"] + args, capture_output=True, text=True).stdout


redir = []
for u in H.get("redirect_starts", []):
    hops, cur = [], u
    for _ in range(6):
        o = curl(["-o", "/dev/null", "-w", "%{http_code} %{redirect_url}", cur]).split()
        code = int(o[0]) if o else 0
        hops.append({"url": cur, "code": code, "to": o[1] if len(o) > 1 else ""})
        if not (300 <= code < 400) or len(o) < 2: break
        cur = o[1]
    final = hops[-1]
    ok = len(hops) == 2 and hops[0]["code"] in (301, 308) and final["code"] == 200 and final["url"].startswith(C["_origin"])
    redir.append({"start": u, "hops": hops, "oneHopPermanent": ok})
samples = []
for p in H.get("samples", []):
    u = _cfg.abs_url(C, p)
    for i in (1, 2):
        h = curl(["-o", "/dev/null", "-D", "-", "-H", "Accept-Encoding: gzip, br", "-w", "\nTTFB=%{time_starttransfer}", u]); low = h.lower()
        samples.append({"url": u, "try": i, "encoding": (re.findall(r"content-encoding:\s*(\S+)", low) or [""])[-1],
                        "cache": re.findall(r"^(x-cache|cf-cache-status|x-nextjs-cache|x-vercel-cache|age|via|server):\s*(.+?)\s*$", low, re.M),
                        "ttfb": float((re.findall(r"TTFB=([\d.]+)", h) or ["0"])[-1])})
out = {"redirects": redir, "samples": samples, "compressed": sum(1 for s in samples if s["encoding"]), "sampleCount": len(samples)}
json.dump(out, open(os.path.join(C["_dir"], "http-checks.json"), "w"), ensure_ascii=False, indent=1)
for r in redir: print(r["start"], "一跳永久跳转" if r["oneHopPermanent"] else "不合格", [(h["code"], h["to"]) for h in r["hops"]])
for s in samples: print(s["url"], s["try"], s["encoding"] or "未压缩", s["cache"][:2], s["ttfb"])
