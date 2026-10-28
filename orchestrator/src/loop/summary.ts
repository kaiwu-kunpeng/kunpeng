import type { LoopDef, Wave } from "./types.js";

export interface LoopInsight {
  trend: string;
  recent: string;
  blockers: string;
  next: string;
}

export function readableSubject(wave: Wave): string {
  const s = wave.subject ?? "";
  const trimmed = s.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as { enumName?: unknown };
      if (typeof obj.enumName === "string" && obj.enumName.trim()) return obj.enumName.trim();
    } catch {
      // Fall back to the original subject when JSON parsing fails.
    }
  }
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

export function summarizeLoop(loop: LoopDef): LoopInsight {
  const waves = [...loop.waves].sort((a, b) => b.seq - a.seq);
  const recent5 = waves.slice(0, 5);
  const older5 = waves.slice(5, 10);
  const sumDelta = (ws: Wave[]) => ws.reduce((acc, w) => acc + (w.metricDelta || 0), 0);
  const r5 = sumDelta(recent5);
  const o5 = sumDelta(older5);
  const label = loop.metric.label;
  const current = loop.metric.current;

  let trend: string;
  if (waves.length === 0) {
    trend = `暂无 wave，${label}=${current}`;
  } else if (r5 === 0) {
    trend = `近 ${recent5.length} 轮 0 增量（${label}=${current}），停滞——建议换杠杆或排查抓取`;
  } else {
    const mood = older5.length === 0 ? "起步" : r5 > o5 * 1.1 ? "加速" : r5 < o5 * 0.9 ? "放缓" : "平稳";
    trend = `近 ${recent5.length} 轮 +${r5}（${label} 至 ${current}），势头${mood}`;
  }

  const subjects: string[] = [];
  const seen = new Set<string>();
  for (const w of recent5) {
    const s = readableSubject(w);
    if (s && !seen.has(s)) {
      seen.add(s);
      subjects.push(s);
    }
  }
  const recent = recent5.length === 0
    ? "—"
    : `最近：${subjects.join(" / ") || recent5.map((w) => w.lever).join(" / ")}`;

  const honestZero = loop.levers.filter((l) => l.status === "honest-zero").length;
  const zeroDelta = recent5.filter((w) => (w.metricDelta || 0) === 0).length;
  const unverified = recent5.filter((w) => !w.verified).length;
  const parts: string[] = [];
  if (zeroDelta > 0) parts.push(`${zeroDelta} 轮零增量`);
  if (unverified > 0) parts.push(`${unverified} 轮未验证`);
  if (honestZero > 0) parts.push(`${honestZero} 个杠杆诚实零`);
  const blockers = parts.length ? `卡点：${parts.join("、")}` : "无明显卡点";

  let next: string;
  if (loop.nextLever) {
    const lv = loop.levers.find((l) => l.id === loop.nextLever?.lever);
    const name = lv?.label ?? loop.nextLever.lever;
    next = `下一步已排：${name}`;
  } else if (waves.length === 0) {
    next = "下一步：设定首个杠杆";
  } else if (r5 === 0) {
    next = "下一步：建议换杠杆（当前停滞）";
  } else {
    next = "下一步：可继续当前杠杆";
  }

  return { trend, recent, blockers, next };
}
