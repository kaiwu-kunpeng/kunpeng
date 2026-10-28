# -*- coding: utf-8 -*-
"""公共：读审计配置、读 key、URL 与语种目录工具、落盘文件名。所有脚本 import 它。"""
import json, os, re, sys, urllib.parse


def load(path):
    c = json.load(open(path))
    c["_dir"] = os.path.dirname(os.path.abspath(path))
    u = urllib.parse.urlsplit(c["origin"].rstrip("/"))
    c["_origin"] = f"{u.scheme}://{u.netloc}"; c["_host"] = u.netloc
    c["_domain"] = u.netloc.removeprefix("www.")
    return c


def key(name):
    """优先环境变量，其次 ~/.kunpeng/seo-keys.env。脚本内部读，命令行里不要同时出现 key 文件路径和 curl（会被安全绊线拦）。"""
    if os.environ.get(name): return os.environ[name]
    p = os.path.expanduser("~/.kunpeng/seo-keys.env")
    if os.path.exists(p):
        for l in open(p):
            if l.startswith(name + "="): return l.strip().split("=", 1)[1]
    sys.exit(f"缺 {name}：写进 ~/.kunpeng/seo-keys.env 或设环境变量")


def abs_url(c, u): return u if u.startswith("http") else c["_origin"] + ("" if u.startswith("/") else "/") + u


def locale_of(c, url):
    """按路径第一段判语种；没有目录的语种（dir 为空）是默认语种。"""
    seg = urllib.parse.urlsplit(url).path.strip("/").split("/")[0]
    default = next((k for k, v in c["locales"].items() if not v.get("dir")), None)
    for k, v in c["locales"].items():
        if v.get("dir") and seg == v["dir"]: return k
    return default


def strip_locale(c, url):
    p = urllib.parse.urlsplit(url).path
    loc = locale_of(c, url); d = c["locales"].get(loc, {}).get("dir") if loc else None
    if d and (p.strip("/") + "/").startswith(d + "/"): p = "/" + p.strip("/")[len(d):].strip("/")
    return "/" + p.strip("/")


def page_type(c, url):
    p = strip_locale(c, url)
    for name, rx in c.get("page_types", []):
        if re.search(rx, p): return name
    return "栏目与其他页"


def html_file(c, url):
    """落盘文件名（crawl.py 写、analyze.py 读，两边必须一致）。"""
    path = url[len(c["_origin"]):] if url.startswith(c["_origin"]) else url
    return os.path.join(c["_dir"], "html", (re.sub(r"[^A-Za-z0-9]+", "_", path)[:180] or "root") + ".html.gz")
