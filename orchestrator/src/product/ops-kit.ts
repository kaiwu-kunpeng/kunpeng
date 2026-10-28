import { appendFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { productLoopDir } from "./loop-store.js";

export type OpsEventKind = "pageview" | "error" | "event";

export interface OpsEvent {
  kind: OpsEventKind;
  name?: string;
  at: number;
}

export interface ProductPick {
  selector: string;
  text?: string;
  at: number;
}

export interface ProductFeedback {
  score: number;
  comment?: string;
  at: number;
}

const OPS_EVENT_FILE = "ops-events.jsonl";
const PICK_FILE = "picks.jsonl";
const FEEDBACK_FILE = "feedback.jsonl";
const MAX_OPS_EVENT_BYTES = 5 * 1024 * 1024;
const MAX_PICK_BYTES = 1024 * 1024;
const MAX_FEEDBACK_BYTES = 1024 * 1024;
const DEFAULT_SINCE_MS = 7 * 86400000;

export function kpBeaconSnippet(slug: string, base: string, token: string): string {
  const script = [
    "(function(){",
    `var slug=${JSON.stringify(slug)};`,
    `var base=${JSON.stringify(base)};`,
    `var token=${JSON.stringify(token)};`,
    'var endpoint=base+"/api/beacon";',
    "function send(kind,name){",
    "try{",
    "var body={slug:slug,kind:kind,t:token};",
    "if(name!==undefined){body.name=String(name);}",
    "var payload=JSON.stringify(body);",
    'if(typeof navigator!=="undefined"&&navigator.sendBeacon){navigator.sendBeacon(endpoint,payload);return;}',
    'if(typeof fetch==="function"){fetch(endpoint,{method:"POST",keepalive:true,headers:{"content-type":"application/json"},body:payload}).catch(function(){});}',
    "}catch(e){}",
    "}",
    "try{",
    'if(typeof location!=="undefined"&&/(^|[?&])kp-pick=1(&|$)/.test(location.search)){',
    "var pickedEl=null;",
    "var pickedOutline='';",
    "function restorePick(){if(pickedEl){pickedEl.style.outline=pickedOutline;pickedEl=null;pickedOutline='';}}",
    "function selectorFor(el){",
    'if(el.id){return "#"+String(el.id);}',
    "var parts=[];",
    "while(el&&el.nodeType===1&&parts.length<3){",
    "var tag=String(el.tagName||'').toLowerCase();",
    "var n=1;",
    "var sib=el;",
    "while((sib=sib.previousElementSibling)){if(sib.tagName===el.tagName){n++;}}",
    'parts.push(tag+":nth-of-type("+n+")");',
    "el=el.parentElement;",
    "}",
    'return parts.reverse().join(">");',
    "}",
    "function sendPick(selector,text){",
    "try{",
    'var payload=JSON.stringify({slug:slug,kind:"pick",selector:selector,text:text,t:token});',
    'if(typeof navigator!=="undefined"&&navigator.sendBeacon){return navigator.sendBeacon(endpoint,payload);}',
    'if(typeof fetch==="function"){fetch(endpoint,{method:"POST",keepalive:true,headers:{"content-type":"application/json"},body:payload}).catch(function(){});return true;}',
    "return false;",
    "}catch(e){return false;}",
    "}",
    "function onOver(e){",
    "var el=e.target;",
    "if(!el||!el.style){return;}",
    "if(pickedEl!==el){restorePick();pickedEl=el;pickedOutline=el.style.outline;}",
    'el.style.outline="2px solid #f59e0b";',
    "}",
    "function onOut(e){if(e.target===pickedEl){restorePick();}}",
    "function flash(el){",
    "if(!el||!el.style){return;}",
    'el.style.outline="2px solid #22c55e";',
    'setTimeout(function(){if(pickedEl===el){el.style.outline="2px solid #f59e0b";}},250);',
    "}",
    "function onClick(e){",
    "var el=e.target;",
    "if(!el){return;}",
    "e.preventDefault();",
    "e.stopPropagation();",
    "var selector=selectorFor(el);",
    'var text=String(el.innerText||"").trim().slice(0,80);',
    "if(sendPick(selector,text)){flash(el);}",
    "}",
    "function stopPick(){",
    "restorePick();",
    'document.removeEventListener("mouseover",onOver,true);',
    'document.removeEventListener("mouseout",onOut,true);',
    'document.removeEventListener("click",onClick,true);',
    'document.removeEventListener("keydown",onKey,true);',
    "}",
    'function onKey(e){if(e.key==="Escape"){stopPick();}}',
    'document.addEventListener("mouseover",onOver,true);',
    'document.addEventListener("mouseout",onOut,true);',
    'document.addEventListener("click",onClick,true);',
    'document.addEventListener("keydown",onKey,true);',
    "}",
    "}catch(e){}",
    "try{",
    'if(typeof document!=="undefined"&&!(typeof location!=="undefined"&&/(^|[?&])kp-pick=1(&|$)/.test(location.search))){',
    "var fbOpen=false;",
    "var fbScore=0;",
    'var fbBtn=document.createElement("button");',
    'fbBtn.type="button";',
    'fbBtn.textContent="反馈";',
    'fbBtn.setAttribute("aria-label","反馈");',
    'fbBtn.style.cssText="position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111827;color:#fff;border:0;border-radius:999px;padding:10px 14px;font-size:14px;line-height:1;box-shadow:0 8px 24px rgba(0,0,0,.18);cursor:pointer;";',
    'var fbPanel=document.createElement("div");',
    'fbPanel.style.cssText="display:none;position:fixed;right:16px;bottom:58px;z-index:2147483647;width:260px;background:#fff;color:#111827;border:1px solid #d1d5db;border-radius:8px;padding:12px;box-shadow:0 12px 32px rgba(0,0,0,.22);font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:14px;";',
    "function closeFb(){fbOpen=false;fbPanel.style.display='none';}",
    "function openFb(){fbOpen=true;fbPanel.style.display='block';}",
    "function fbForm(){",
    'fbPanel.innerHTML=\'<div style="font-weight:600;margin-bottom:8px">反馈</div><div style="display:flex;gap:6px;margin-bottom:8px"><button type="button" data-kp-score="1">1</button><button type="button" data-kp-score="2">2</button><button type="button" data-kp-score="3">3</button><button type="button" data-kp-score="4">4</button><button type="button" data-kp-score="5">5</button></div><textarea rows="3" placeholder="留言" style="box-sizing:border-box;width:100%;resize:vertical;margin-bottom:8px"></textarea><button type="button" data-kp-submit="1" style="width:100%;padding:8px;border:0;border-radius:6px;background:#111827;color:#fff;cursor:pointer">提交</button>\';',
    'var bs=fbPanel.querySelectorAll("[data-kp-score]");',
    'for(var i=0;i<bs.length;i++){bs[i].style.cssText="width:34px;height:30px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#111827;cursor:pointer";}',
    "}",
    "function markFbScore(){",
    'var bs=fbPanel.querySelectorAll("[data-kp-score]");',
    'for(var i=0;i<bs.length;i++){var on=Number(bs[i].getAttribute("data-kp-score"))===fbScore;bs[i].style.background=on?"#2563eb":"#fff";bs[i].style.color=on?"#fff":"#111827";}',
    "}",
    "function submitFb(){",
    "try{",
    "if(!fbScore){return;}",
    'var ta=fbPanel.querySelector("textarea");',
    'var comment=ta?String(ta.value||""):"";',
    'var payload=JSON.stringify({slug:slug,kind:"feedback",score:fbScore,comment:comment,t:token});',
    'var done=function(){fbPanel.innerHTML="<div>已收到，谢谢</div>";setTimeout(function(){closeFb();fbScore=0;fbForm();},2000);};',
    'if(typeof fetch==="function"){fetch(endpoint,{method:"POST",keepalive:true,headers:{"content-type":"application/json"},body:payload}).then(function(){done();}).catch(function(){});return;}',
    'if(typeof navigator!=="undefined"&&navigator.sendBeacon){if(navigator.sendBeacon(endpoint,payload)){done();}}',
    "}catch(e){}",
    "}",
    'fbPanel.addEventListener("click",function(e){',
    "var t=e.target;",
    'if(t&&t.getAttribute&&t.getAttribute("data-kp-score")){fbScore=Number(t.getAttribute("data-kp-score"));markFbScore();return;}',
    'if(t&&t.getAttribute&&t.getAttribute("data-kp-submit")==="1"){submitFb();}',
    "});",
    'fbBtn.addEventListener("click",function(){if(fbOpen){closeFb();}else{openFb();}});',
    'document.addEventListener("keydown",function(e){if(e.key==="Escape"){closeFb();}});',
    "fbForm();",
    "document.body.appendChild(fbPanel);",
    "document.body.appendChild(fbBtn);",
    "}",
    "}catch(e){}",
    'send("pageview");',
    'window.addEventListener("error",function(e){send("error",String(e&&e.message?e.message:"").slice(0,100));});',
    'window.kpTrack=function(name){send("event",name);};',
    "})();",
  ].join("");
  return `<script>${script}</script>`;
}

export async function appendOpsEvent(
  repoRoot: string,
  slug: string,
  evt: { kind: string; name?: string },
  now: number,
): Promise<boolean> {
  try {
    if (!isOpsEventKind(evt.kind)) {
      return false;
    }

    const dir = productLoopDir(repoRoot, slug);
    const dirStat = await stat(dir);
    if (!dirStat.isDirectory()) {
      return false;
    }

    const file = join(dir, OPS_EVENT_FILE);
    const existingSize = await readFileSize(file);
    if (existingSize === undefined || existingSize >= MAX_OPS_EVENT_BYTES) {
      return false;
    }

    const event: OpsEvent = { kind: evt.kind, at: now };
    if (evt.name !== undefined) {
      event.name = evt.name.slice(0, 60);
    }

    await appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function appendPick(
  repoRoot: string,
  slug: string,
  pick: { selector: string; text?: string },
  now: number,
): Promise<boolean> {
  try {
    const selector = pick.selector.trim().slice(0, 200);
    if (selector.length === 0) {
      return false;
    }

    const dir = productLoopDir(repoRoot, slug);
    const dirStat = await stat(dir);
    if (!dirStat.isDirectory()) {
      return false;
    }

    const file = join(dir, PICK_FILE);
    const existingSize = await readFileSize(file);
    if (existingSize === undefined || existingSize >= MAX_PICK_BYTES) {
      return false;
    }

    const record: ProductPick = { selector, at: now };
    if (pick.text !== undefined) {
      record.text = pick.text.slice(0, 120);
    }

    await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function appendFeedback(
  repoRoot: string,
  slug: string,
  fb: { score: number; comment?: string },
  now: number,
): Promise<boolean> {
  try {
    if (!Number.isInteger(fb.score) || fb.score < 1 || fb.score > 5) {
      return false;
    }

    const dir = productLoopDir(repoRoot, slug);
    const dirStat = await stat(dir);
    if (!dirStat.isDirectory()) {
      return false;
    }

    const file = join(dir, FEEDBACK_FILE);
    const existingSize = await readFileSize(file);
    if (existingSize === undefined || existingSize >= MAX_FEEDBACK_BYTES) {
      return false;
    }

    const record: ProductFeedback = { score: fb.score, at: now };
    if (fb.comment !== undefined) {
      record.comment = fb.comment.slice(0, 500);
    }

    await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function readRecentPicks(repoRoot: string, slug: string, limit = 5): Promise<ProductPick[]> {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) {
    return [];
  }

  let raw: string;
  try {
    raw = await readFile(join(productLoopDir(repoRoot, slug), PICK_FILE), "utf8");
  } catch {
    return [];
  }

  const picks: ProductPick[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    const pick = parsePickLine(line);
    if (pick) {
      picks.push(pick);
    }
  }

  return picks.slice(-safeLimit).reverse();
}

export async function readFeedbackSummary(
  repoRoot: string,
  slug: string,
  opts: { now: number; sinceMs?: number },
): Promise<{ count: number; avgScore: number; recent: ProductFeedback[] } | undefined> {
  const sinceMs = opts.sinceMs ?? DEFAULT_SINCE_MS;
  const threshold = opts.now - sinceMs;
  let raw: string;

  try {
    raw = await readFile(join(productLoopDir(repoRoot, slug), FEEDBACK_FILE), "utf8");
  } catch {
    return undefined;
  }

  const feedback: ProductFeedback[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    const item = parseFeedbackLine(line);
    if (item && item.at >= threshold) {
      feedback.push(item);
    }
  }

  if (feedback.length === 0) {
    return undefined;
  }

  const total = feedback.reduce((sum, item) => sum + item.score, 0);
  const recent = [...feedback].sort((a, b) => b.at - a.at).slice(0, 3);
  return { count: feedback.length, avgScore: Math.round((total / feedback.length) * 10) / 10, recent };
}

export async function readOpsSummary(
  repoRoot: string,
  slug: string,
  opts: { now: number; sinceMs?: number },
): Promise<
  | {
      pageviews: number;
      errors: number;
      topEvents: Array<{ name: string; count: number }>;
      sinceMs: number;
    }
  | undefined
> {
  const sinceMs = opts.sinceMs ?? DEFAULT_SINCE_MS;
  const threshold = opts.now - sinceMs;
  let raw: string;

  try {
    raw = await readFile(join(productLoopDir(repoRoot, slug), OPS_EVENT_FILE), "utf8");
  } catch {
    return undefined;
  }

  let pageviews = 0;
  let errors = 0;
  const eventCounts = new Map<string, number>();

  for (const line of raw.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    const event = parseOpsEventLine(line);
    if (!event || event.at < threshold) {
      continue;
    }

    if (event.kind === "pageview") {
      pageviews += 1;
    } else if (event.kind === "error") {
      errors += 1;
    } else if (event.name !== undefined) {
      eventCounts.set(event.name, (eventCounts.get(event.name) ?? 0) + 1);
    }
  }

  const topEvents = Array.from(eventCounts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return { pageviews, errors, topEvents, sinceMs };
}

function isOpsEventKind(kind: string): kind is OpsEventKind {
  return kind === "pageview" || kind === "error" || kind === "event";
}

async function readFileSize(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size;
  } catch (err) {
    if (hasErrorCode(err, "ENOENT")) {
      return 0;
    }
    return undefined;
  }
}

function parseOpsEventLine(line: string): OpsEvent | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }

    const record = parsed as { kind?: unknown; name?: unknown; at?: unknown };
    if (typeof record.kind !== "string" || !isOpsEventKind(record.kind)) {
      return undefined;
    }
    if (typeof record.at !== "number" || !Number.isFinite(record.at)) {
      return undefined;
    }

    const event: OpsEvent = { kind: record.kind, at: record.at };
    if (typeof record.name === "string") {
      event.name = record.name;
    }
    return event;
  } catch {
    return undefined;
  }
}

function parsePickLine(line: string): ProductPick | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }

    const record = parsed as { selector?: unknown; text?: unknown; at?: unknown };
    if (typeof record.selector !== "string" || record.selector.length === 0) {
      return undefined;
    }
    if (typeof record.at !== "number" || !Number.isFinite(record.at)) {
      return undefined;
    }

    const pick: ProductPick = { selector: record.selector, at: record.at };
    if (typeof record.text === "string") {
      pick.text = record.text;
    }
    return pick;
  } catch {
    return undefined;
  }
}

function parseFeedbackLine(line: string): ProductFeedback | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }

    const record = parsed as { score?: unknown; comment?: unknown; at?: unknown };
    if (typeof record.score !== "number" || !Number.isInteger(record.score) || record.score < 1 || record.score > 5) {
      return undefined;
    }
    if (typeof record.at !== "number" || !Number.isFinite(record.at)) {
      return undefined;
    }

    const feedback: ProductFeedback = { score: record.score, at: record.at };
    if (typeof record.comment === "string") {
      feedback.comment = record.comment;
    }
    return feedback;
  } catch {
    return undefined;
  }
}

function hasErrorCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === code;
}
