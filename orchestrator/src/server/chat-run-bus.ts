const CHAT_RUN_TTL_MS = 10 * 60 * 1000;
const CHAT_RUN_BUFFER_LIMIT = 20_000;
const REPLAY_GAP_FRAME = '<div class="kp-ev kp-ev-stage">部分早期输出未能回放,完整内容以历史记录为准</div>';
const END_FRAME = "event: end\ndata: {}\n\n";

type ChatRunResponse = {
  write(chunk: string): unknown;
};

type BufferedFrame = {
  seq: number;
  chunk: string;
};

export interface ChatRun {
  readonly seq: number;
  readonly done: boolean;
  emit(html: string): void;
  subscribe(res: ChatRunResponse, after?: number): () => void;
  endRun(): void;
  bindAbort(fn: () => void): void;
  abort(): void;
}

const runs = new Map<string, ChatRun>();

export function chatRunKey(username: string, convId: string): string {
  return `${username}/${convId}`;
}

export function createChatRun(key: string): ChatRun {
  const frames: BufferedFrame[] = [];
  const subscribers = new Set<ChatRunResponse>();
  let seq = 0;
  let done = false;
  let bufferOverflowed = false;
  let abortRun: (() => void) | undefined;

  const run: ChatRun = {
    get seq() {
      return seq;
    },
    get done() {
      return done;
    },
    emit(html) {
      if (done) return;
      seq += 1;
      const chunk = `id: ${seq}\n${html.split("\n").map((line) => `data: ${line}`).join("\n")}\n\n`;
      frames.push({ seq, chunk });
      if (frames.length > CHAT_RUN_BUFFER_LIMIT) {
        frames.shift();
        bufferOverflowed = true;
      }
      for (const subscriber of subscribers) subscriber.write(chunk);
    },
    subscribe(res, after = 0) {
      const replayAfter = Number.isFinite(after) ? Math.max(0, Math.floor(after)) : 0;
      const earliestSeq = frames[0]?.seq;
      if (bufferOverflowed && earliestSeq !== undefined && replayAfter < earliestSeq) {
        res.write(`data: ${REPLAY_GAP_FRAME}\n\n`);
      }
      for (const frame of frames) {
        if (frame.seq > replayAfter) res.write(frame.chunk);
      }
      if (done) {
        res.write(END_FRAME);
        return () => {};
      }
      subscribers.add(res);
      return () => {
        subscribers.delete(res);
      };
    },
    endRun() {
      if (done) return;
      done = true;
      for (const subscriber of subscribers) subscriber.write(END_FRAME);
      subscribers.clear();
      const timer = setTimeout(() => {
        if (runs.get(key) === run) runs.delete(key);
      }, CHAT_RUN_TTL_MS);
      timer.unref();
    },
    bindAbort(fn) {
      abortRun = fn;
    },
    abort() {
      abortRun?.();
    },
  };

  // 同一会话新 run 接管前,先掐掉仍在跑的旧 run:先 abort 再 endRun,避免旧生成继续写帧。
  try {
    const prev = runs.get(key);
    if (prev && prev.done === false) {
      console.warn(`[chat-run] 接管仍在跑的旧 run(路由层 409 应先拦住,这里只是竞态兜底):${key}`);
      prev.abort();
      prev.endRun();
    }
  } catch {
    // abort/endRun 抛错不得让新 run 创建失败。
  }

  runs.set(key, run);
  return run;
}

export function getChatRun(key: string): ChatRun | undefined {
  return runs.get(key);
}
