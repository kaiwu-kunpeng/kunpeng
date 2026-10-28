import type { ServerResponse } from "node:http";
import { escHtml } from "../util/esc-html.js";

export { escHtml };

// SSE 规范:data 里的换行必须拆成多条 `data:` 行,EventSource 会用 \n 拼回。
// token 增量/命令输出常含换行,否则裸 \n 会提前终止消息、吞掉换行后的 HTML。
export function sseData(res: Pick<ServerResponse, "write">, html: string): void {
  res.write(`${html.split("\n").map((line) => `data: ${line}`).join("\n")}\n\n`);
}

export function setSseHeaders(res: Pick<ServerResponse, "setHeader">): void {
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("x-accel-buffering", "no");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
}

// SSE 心跳(注释帧,EventSource 忽略)。agent 生成大工具参数(如整份 HTML 的 localfs_write)期间
// 没有任何 text 增量,SSE 可静默数分钟;Cloudflare Tunnel 约 100s 无数据就掐连接,断线又会
// abort 掉子进程,把正在写的文件杀死在半路——心跳让代理链路上永远有字节在流。
export function startSseHeartbeat(res: Pick<ServerResponse, "write">, intervalMs = 15_000): () => void {
  const timer = setInterval(() => {
    try { res.write(":hb\n\n"); } catch { /* 连接已关,由 close 收口 */ }
  }, intervalMs);
  return () => clearInterval(timer);
}
