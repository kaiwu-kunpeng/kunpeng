/** SSE 单帧:`event: <name>\ndata: <data>\n\n`。data 多行按 SSE 规范每行加 data: 前缀。 */
export function sseFrame(event: string, data = ""): string {
  const lines = data.split("\n").map((l) => `data: ${l}`).join("\n");
  return `event: ${event}\n${lines}\n\n`;
}

/** SSE 响应头(禁缓存、保持连接、关闭代理缓冲)。 */
export function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
  };
}
