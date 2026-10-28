/**
 * 纯函数:多窗口工作台外壳(像桌面一样多开对话/任务窗口,各自独立会话/模型/token)。
 * 左侧常驻栏(类 Claude/ChatGPT):品牌 + ＋新对话/＋新任务 + 历史会话列表容器 #kp-conv-list
 *   (空容器,列表由 client.ts 填充);右侧主区 = 自适应窗口网格 #kp-windows,每个窗口由 client.ts 动态创建。
 * 全程 var(--) 主题 token 双皮肤。summaryHtml = 原摘要,降级进折叠区。
 */
export const inboxUnreadCss = `
  .kp-inbox-unread{border-left:4px solid var(--primary);box-shadow:var(--shadow-card),inset 3px 0 0 var(--primary-soft)}
  .kp-inbox-unread .gate-h .ti{font-weight:760;color:var(--ink)}
  .kp-inbox-unread .gate-h .ti::after{content:"";display:inline-block;width:7px;height:7px;margin-left:8px;border-radius:50%;background:var(--primary);box-shadow:0 0 0 3px var(--primary-soft);vertical-align:1px}
`;

export function renderWorkbenchPanel(summaryHtml: string): string {
  return `
    <style>
      ${inboxUnreadCss}
      .kp-wb{height:100%;display:flex;gap:12px;min-height:0}
      .kp-wb-side{width:260px;flex-shrink:0;display:flex;flex-direction:column;gap:10px;min-height:0;
        background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;box-shadow:var(--sh-md)}
      .kp-wb-brand{font-weight:700;font-size:15px;color:var(--ink);padding:0 4px}
      .kp-wb-actions{display:flex;flex-direction:column;gap:8px}
      .kp-wb-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}
      .kp-wb-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0}
      .kp-wb-bar .ttl{font-weight:700;font-size:15px;color:var(--ink)}
      .kp-newbtn{font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid var(--line);
        background:var(--card);color:var(--ink);border-radius:9px;padding:7px 14px}
      .kp-newbtn:hover{border-color:var(--primary-line);color:var(--primary)}
      .kp-wb-tip{font-size:11.5px;color:var(--muted)}
      .kp-conv-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:1px;margin-top:2px}
      .kp-conv-search{width:100%;box-sizing:border-box;margin-top:6px;padding:6px 9px;font-size:12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font-family:var(--sans)}
      .kp-conv-search:focus{outline:none;border-color:var(--primary-line)}
      .kp-conv-group{font-size:11px;font-weight:600;color:var(--muted);padding:8px 6px 3px}
      .kp-conv-item{position:relative;display:flex;flex-direction:column;gap:2px;padding:7px 26px 7px 9px;border-radius:8px;cursor:pointer;
        font-family:var(--sans)}
      .kp-conv-item:hover{background:var(--primary-soft)}
      .kp-conv-item .ct{font-size:13px;color:var(--ink);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .kp-conv-item .kp-conv-snip{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .kp-conv-item .cm{font-size:11px;color:var(--muted)}
      .kp-conv-del{position:absolute;top:6px;right:5px;width:18px;height:18px;border:none;border-radius:6px;background:transparent;
        color:var(--muted);font-size:11px;line-height:1;cursor:pointer;opacity:0;padding:0}
      .kp-conv-exp{position:absolute;top:6px;right:26px;width:18px;height:18px;border:none;border-radius:6px;background:transparent;color:var(--muted);font-size:11px;line-height:1;cursor:pointer;opacity:0;padding:0}
      .kp-conv-item:hover .kp-conv-del{opacity:1}
      .kp-conv-item:hover .kp-conv-exp{opacity:1}
      .kp-conv-del:hover{background:var(--line-2);color:var(--danger)}
      .kp-conv-exp:hover{background:var(--line-2);color:var(--primary)}
      .kp-conv-empty{padding:14px 8px;font-size:12px;color:var(--muted);font-family:var(--sans)}
      .kp-windows{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(540px,100%),1fr));
        gap:14px;align-content:start;overflow:auto;padding-bottom:6px}
      .kp-win{display:flex;position:relative;flex-direction:column;height:calc(100vh - 214px);max-height:calc(100vh - 214px);
        background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:var(--sh-md);
        font-family:var(--mono)}
      .kp-win-active{border-color:var(--primary);box-shadow:var(--sh-md),0 0 0 2px color-mix(in srgb,var(--primary) 24%,transparent)}
      .kp-win-search{display:flex;align-items:center;gap:6px;padding:7px 10px;background:var(--card);border-bottom:1px solid var(--line);font-family:var(--sans);flex-shrink:0}
      .kp-win-search[hidden]{display:none}
      .kp-win-search-input{min-width:90px;flex:1;padding:5px 8px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--ink);font:inherit;font-size:12px;outline:none}
      .kp-win-search-input:focus{border-color:var(--primary-line)}
      .kp-win-search-count{min-width:38px;color:var(--muted);font-size:11.5px;text-align:center;white-space:nowrap}
      .kp-win-search button{width:27px;height:27px;padding:0;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--ink-2);cursor:pointer;font:inherit}
      .kp-win-search button:hover,.kp-win-search button:focus-visible{border-color:var(--primary-line);color:var(--primary);outline:none}
      .kp-search-hit{background:var(--warn-soft);box-shadow:inset 3px 0 0 var(--warn);border-radius:5px}
      .kp-search-current{background:var(--primary-soft);box-shadow:inset 3px 0 0 var(--primary),0 0 0 1px var(--primary-line)}
      .kp-term-bar{display:flex;flex-wrap:wrap;align-items:center;gap:9px;row-gap:6px;padding:10px 14px;background:var(--card);border-bottom:1px solid var(--line);flex-shrink:0}
      .kp-term-dots{display:flex;gap:6px}
      .kp-term-dots i{width:10px;height:10px;border-radius:50%;display:block}
      /* macOS 窗控装饰色，故意不随皮肤 */
      .kp-term-dots i:nth-child(1){background:#ff5f57}
      .kp-term-dots i:nth-child(2){background:#febc2e}
      .kp-term-dots i:nth-child(3){background:#28c840}
      .kp-term-title{display:flex;align-items:center;gap:8px;min-width:0;max-width:260px;color:var(--ink);font-size:13px;font-weight:600;white-space:nowrap}
      .kp-term-title-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
      .kp-term-avatar{width:21px;height:21px;border-radius:6px;background:linear-gradient(135deg,var(--primary-2),var(--primary));
        display:flex;align-items:center;justify-content:center;color:var(--on-primary);font-size:11.5px;font-weight:800;
        font-family:var(--sans)}
      .kp-lbl{font-size:11px;color:var(--muted);white-space:nowrap}
      .kp-model{font-family:inherit;font-size:11.5px;font-weight:600;color:var(--primary);cursor:pointer;
        background:var(--primary-soft);border:1px solid var(--primary-line);border-radius:8px;padding:3px 8px;outline:none}
      .kp-localfs-chip{font-family:inherit;font-size:11.5px;font-weight:600;color:var(--muted);cursor:pointer;
        background:var(--card);border:1px solid var(--line);border-radius:8px;padding:3px 9px;outline:none;display:inline-flex;align-items:center;gap:5px}
      .kp-localfs-chip:hover{border-color:var(--primary-line);background:var(--primary-soft);color:var(--ink-2)}
      .kp-localfs-chip.on{background:var(--success-soft);border-color:var(--success-line);color:var(--success)}
      .kp-localfs-chip.busy{background:var(--primary-soft);border-color:var(--primary-line);color:var(--primary)}
      .kp-localfs-chip .x{margin-left:3px;opacity:.55;font-weight:700}
      .kp-localfs-chip .x:hover{opacity:1}
      .kp-localfs-ev{color:var(--primary)}
      .kp-toks{font-size:11.5px;font-weight:600;color:var(--ink-2);white-space:nowrap}
      .kp-term-status{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12px;white-space:nowrap}
      .kp-term-status .dot{width:7px;height:7px;border-radius:50%;background:var(--success);box-shadow:0 0 8px var(--success)}
      .kp-win-close{background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:3px 7px;border-radius:6px;line-height:1;flex-shrink:0}
      .kp-win-close:hover{background:var(--line-2);color:var(--danger)}
      .kp-help{position:relative;display:inline-flex;align-items:center;flex-shrink:0}
      .kp-help-q{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;
        border:1px solid var(--line);background:var(--card);color:var(--muted);font-family:var(--sans);font-size:10.5px;font-weight:700;
        line-height:1;cursor:pointer;user-select:none;transition:background .12s,color .12s,border-color .12s}
      .kp-help:hover .kp-help-q,.kp-help.on .kp-help-q,.kp-help:focus-visible .kp-help-q{background:var(--primary-soft);border-color:var(--primary-line);color:var(--primary)}
      .kp-help.on .kp-help-q{background:var(--primary);border-color:var(--primary);color:#fff}
      .kp-help-pop{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);z-index:40;width:262px;
        padding:11px 13px;background:var(--card);border:1px solid var(--line);border-radius:11px;box-shadow:var(--sh-md);
        color:var(--ink-2);font-family:var(--sans);font-size:12px;line-height:1.7;white-space:normal;text-align:left;
        opacity:0;visibility:hidden;pointer-events:none;transition:opacity .12s}
      .kp-help-pop b{color:var(--ink);font-weight:700}
      .kp-help-pop::before{content:"";position:absolute;bottom:100%;left:50%;transform:translateX(-50%);
        border:6px solid transparent;border-bottom-color:var(--line)}
      .kp-help-pop::after{content:"";position:absolute;bottom:100%;left:50%;transform:translateX(-50%) translateY(1px);
        border:6px solid transparent;border-bottom-color:var(--card)}
      .kp-help:hover .kp-help-pop,.kp-help.on .kp-help-pop,.kp-help:focus-within .kp-help-pop{opacity:1;visibility:visible;pointer-events:auto}
      .kp-stream{flex:1;min-height:0;padding:15px 18px;overflow:auto;background:var(--bg);
        font-size:13px;line-height:1.8;color:var(--ink-2);white-space:pre-wrap;word-break:break-word}
      .kp-ctx-warning-note{margin:8px 0;padding:7px 10px;border-left:3px solid var(--warn);border-radius:6px;background:var(--warn-soft);color:var(--warn);font-family:var(--sans);font-weight:600}
      .kp-chat-alternative{color:var(--muted);font-size:12px}
      .kp-localfs-host{color:var(--muted);font-size:11.5px}
      .kp-mermaid-error{color:var(--danger);font-family:var(--sans)}
      .kp-msg-content{display:block;white-space:normal}
      .kp-md-segment{display:contents}
      .kp-msg-content p{margin:5px 0}
      .kp-msg-content .kp-md-h{margin:12px 0 5px;color:var(--ink);line-height:1.35;font-weight:700}
      .kp-msg-content h1.kp-md-h{font-size:1.45em}
      .kp-msg-content h2.kp-md-h{font-size:1.32em}
      .kp-msg-content h3.kp-md-h{font-size:1.2em}
      .kp-msg-content h4.kp-md-h{font-size:1.1em}
      .kp-msg-content h5.kp-md-h{font-size:1.02em}
      .kp-msg-content h6.kp-md-h{font-size:.96em;color:var(--ink-2)}
      .kp-msg-content ul,.kp-msg-content ol{margin:5px 0;padding-left:24px}
      .kp-msg-content li{margin:2px 0}
      .kp-msg-content .kp-md-ic{padding:1px 5px;border-radius:5px;background:var(--line);color:var(--ink);font-family:var(--mono)}
      .kp-code-block{margin:8px 0;max-width:100%;overflow:hidden;background:var(--bg);border:1px solid var(--line);border-radius:8px}
      .kp-code-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 8px;
        background:var(--card);border-bottom:1px solid var(--line);color:var(--muted);font-family:var(--sans);font-size:11px}
      .kp-code-lang{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono)}
      .kp-code-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
      .kp-code-copy,.kp-code-toggle{padding:2px 8px;border:1px solid var(--line);border-radius:6px;background:var(--card);
        color:var(--muted);cursor:pointer;font:inherit}
      .kp-code-copy:hover,.kp-code-toggle:hover{border-color:var(--primary-line);color:var(--primary)}
      .kp-msg-content .kp-md-code{margin:0;padding:10px 12px;max-width:100%;overflow:auto;white-space:pre;
        background:var(--bg);border:0;border-radius:0;color:var(--ink);font-family:var(--mono)}
      .kp-msg-content .kp-md-code code{font-family:inherit}
      .kp-code-long:not(.kp-code-expanded) .kp-md-code{max-height:320px}
      .kp-msg-content a{color:var(--primary);word-break:break-word}
      .kp-jump{position:absolute;right:16px;bottom:64px;z-index:5;padding:4px 11px;font-size:12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);cursor:pointer;box-shadow:var(--sh-md);font-family:var(--sans)}
      .kp-jump:hover{border-color:var(--primary-line);color:var(--primary)}
      .kp-stream-empty{color:var(--muted);line-height:2}
      .kp-stream-empty b{color:var(--ink);font-weight:600}
      .kp-ev{margin:1px 0}
      .kp-ev-stage{color:var(--warn);margin-top:5px}
      .kp-ev-stage::before{content:"\\25B8 ";color:var(--muted)}
      .kp-tool{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:8px;background:var(--card);border:1px solid var(--line);font-size:12px}
      .kp-tool .kp-tool-ic{font-size:12px}
      .kp-tool .kp-tool-st{color:var(--muted)}
      .kp-tool-ok{border-color:var(--primary-line)}
      .kp-tool-ok .kp-tool-ic{color:var(--primary)}
      .kp-tool-ok .kp-tool-st{color:var(--primary)}
      .kp-tool-err{border-color:var(--danger)}
      .kp-tool-err .kp-tool-ic{color:var(--danger)}
      .kp-tool-err .kp-tool-st{color:var(--danger)}
      .kp-ev-token{color:var(--ink-2)}
      .kp-ev-token.kp-msg{position:relative}
      .kp-copy{position:absolute;top:5px;right:6px;padding:1px 7px;font-size:11px;line-height:1.5;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--muted);cursor:pointer;opacity:0;transition:opacity .12s}
      @media (hover: none) { .kp-copy { opacity: .75; } }
      .kp-ev-token.kp-msg:hover .kp-copy{opacity:1}
      .kp-copy:hover{color:var(--primary);border-color:var(--primary-line)}
      .kp-ev-think{color:var(--muted);font-style:italic;opacity:.72}
      .kp-send.kp-stop{background:var(--danger)}
      .kp-send.kp-stop:hover{background:var(--danger)}
      .kp-ev-file{color:var(--info)}
      .kp-ev-file::before{content:"\\00B1 ";color:var(--muted)}
      .kp-ev-usage{color:var(--muted);font-size:11.5px;margin-top:2px}
      .kp-ev-usage::before{content:"\\00B7 "}
      .kp-ev-done{color:var(--success);margin-top:6px;font-weight:600}
      .kp-ev-done::before{content:"\\2713 "}
      .kp-ev-error{color:var(--danger);margin-top:6px}
      .kp-ev-error::before{content:"\\2717 "}
      .kp-chat-me{color:var(--primary);margin:10px 0 3px;font-weight:600}
      .kp-chat-me::before{content:"\\203A ";color:var(--muted)}
      .kp-ev-gate{margin:9px 0;padding:11px 13px;background:var(--primary-soft);border:1px solid var(--primary-line);
        border-left:3px solid var(--primary);border-radius:10px;color:var(--ink);display:flex;align-items:center;gap:10px;flex-wrap:wrap;
        font-family:var(--sans)}
      .kp-ev-gate::before{content:"\\25C6";color:var(--primary);font-weight:800}
      .kp-ev-gate button{font-family:inherit;border:none;border-radius:7px;padding:5px 15px;font-size:12.5px;font-weight:700;cursor:pointer}
      .kp-ev-gate [data-gate-yes]{background:var(--primary);color:var(--on-primary)}
      .kp-ev-gate [data-gate-no]{background:var(--line);color:var(--ink-2)}
      .kp-composer{flex-shrink:0;padding:10px 12px;border-top:1px solid var(--line);background:var(--card);position:relative}
      .kp-cmdmenu{position:absolute;left:12px;right:12px;bottom:calc(100% - 4px);background:var(--card);border:1px solid var(--line);
        border-radius:10px;box-shadow:var(--sh-md);overflow:hidden;max-height:240px;overflow-y:auto;z-index:30}
      .kp-cmdrow{display:flex;align-items:baseline;gap:9px;padding:8px 12px;cursor:pointer;font-size:12.5px}
      .kp-cmdrow.sel,.kp-cmdrow:hover{background:var(--primary-soft)}
      .kp-cmdrow .cn{color:var(--primary);font-weight:700;font-family:var(--mono)}
      .kp-cmdrow .cd{color:var(--muted);font-size:11.5px}
      .kp-cmdrow .cb{margin-left:auto;font-size:10px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
      .kp-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
      .kp-chip{position:relative;width:52px;height:52px;border-radius:8px;overflow:hidden;border:1px solid var(--line)}
      .kp-chip img{width:100%;height:100%;object-fit:cover;display:block}
      .kp-chip button{position:absolute;top:1px;right:1px;width:16px;height:16px;border:none;border-radius:50%;background:color-mix(in srgb,var(--ink) 60%,transparent);color:#fff;font-size:9px;line-height:16px;cursor:pointer;padding:0}
      .kp-clip{font-size:11px;color:var(--muted)}
      .kp-cbox{display:flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:10px;padding:4px 6px 4px 12px;background:var(--bg)}
      .kp-cbox:focus-within{border-color:var(--primary-line)}
      .kp-cbox .pmt{color:var(--primary);font-weight:800;user-select:none;line-height:1;align-self:center}
      .kp-cbox textarea{flex:1;background:transparent;border:none;outline:none;resize:none;color:var(--ink);
        font-family:inherit;font-size:13.5px;line-height:1.5;height:24px;min-height:24px;max-height:160px;overflow-y:auto;padding:2px 0;display:block}
      .kp-cbox textarea::placeholder{color:var(--muted)}
      .kp-send{background:var(--primary);color:var(--on-primary);border:none;border-radius:8px;height:30px;padding:0 14px;flex-shrink:0;
        cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600;align-self:center}
      .kp-send:hover{background:var(--primary-2)}
      .kp-old-summary{margin:2px 0 0}
      .kp-old-summary>summary{cursor:pointer;font-size:12.5px;color:var(--muted);padding:6px 0;list-style:none}
      .kp-old-summary>summary::before{content:"\\25B8 ";color:var(--muted)}
      .kp-old-summary[open]>summary::before{content:"\\25BE "}
      @media (max-width:768px){
        .kp-wb{flex-direction:column;gap:8px}
        .kp-wb-side{width:auto;flex-shrink:0}
        .kp-wb-actions{flex-direction:row;gap:8px}
        .kp-wb-actions .kp-newbtn{flex:1}
        .kp-conv-list{max-height:104px}
        .kp-win{height:64vh;max-height:64vh}
        .kp-cbox textarea{font-size:16px}
        .kp-wb-bar{gap:7px}
        #kp-windows{grid-template-columns:1fr}
        .kp-term-bar{flex-wrap:wrap;gap:6px;row-gap:5px;padding:8px 11px}
        .kp-term-bar .kp-lbl{display:none}
        .kp-term-bar .kp-term-status span:not(.dot){display:none}
        .kp-term-bar .kp-model,.kp-term-bar .kp-localfs-chip{min-height:34px;display:inline-flex;align-items:center}
        .kp-win-close{min-width:34px;min-height:34px;display:inline-flex;align-items:center;justify-content:center}
        .kp-projection-switch button{min-height:32px}
        .kp-help-q{width:22px;height:22px}
        .kp-conv-search{min-height:36px}
        .kp-term-title{flex:1 1 auto;min-width:0}
        .kp-send{min-height:36px}
        .kp-win summary{min-height:34px;display:flex;align-items:center}
        .kp-term-bar .kp-help{min-height:34px}
        .kp-win a.more,.kp-wb a.more{min-height:34px;display:inline-flex;align-items:center}
      }
    </style>
    <div class="body" style="display:flex;flex-direction:column;min-height:0">
      <div class="kp-wb">
        <aside class="kp-wb-side" aria-label="历史会话">
          <div class="kp-wb-brand">工作台</div>
          <div class="kp-wb-actions">
            <button class="kp-newbtn" id="kp-new-chat">＋ 新对话</button>
            <button class="kp-newbtn" id="kp-new-task">＋ 新任务</button>
          </div>
          <input class="kp-conv-search" id="kp-conv-search" type="search" placeholder="搜索会话（含正文）" aria-label="搜索会话" />
          <div class="kp-conv-list" id="kp-conv-list"></div>
        </aside>
        <main class="kp-wb-main">
          <div class="kp-wb-bar">
            <span class="kp-wb-tip">像桌面一样多开窗口 · 每个窗口独立会话 / 模型 / token</span>
          </div>
          <div class="kp-windows" id="kp-windows"></div>
          <details class="kp-old-summary"><summary>运行概览</summary>${summaryHtml}</details>
        </main>
      </div>
    </div>
  `;
}
