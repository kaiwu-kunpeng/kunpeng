export const themeCss: string = `*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#FFF8F2;
  --card:#FFFFFF;
  --line:#E8E1DB;
  --line-2:#DBC2B0;
  --ink:#1E1B17;
  --ink-2:#3F4A5A;
  --muted:#554336;
  --muted-2:#887364;
  --primary:#8D4B00;
  --primary-2:#B15F00;
  --on-primary:#fff;
  --primary-soft:#FFDCC3;
  --primary-100:#FAF2EB;
  --primary-line:#DBC2B0;
  --success:#177E4D;
  --success-soft:#EDF9F1;
  --success-line:#BFE8CE;
  --warn:#B45309;
  --on-warn:#fff;
  --warn-soft:#FBF3E4;
  --danger:#BA1A1A;
  --danger-soft:#FFDAD6;
  --danger-line:#F3C7C3;
  --warn-line:#EEDBB4;
  --term-bg:#0B0E14;
  --term-fg:#E6E1CF;
  --term-tab-bg:#161B26;
  --term-tab-active-bg:#0B0E14;
  --term-tab-fg:#E6E1CF;
  --term-tab-border:#2A3346;
  --toast-bg:#2D2118;
  --toast-fg:#FFF8F2;
  --ch-ears:#3b82f6;
  --ch-official:#8b5cf6;
  --ch-module:#06b6d4;
  --ch-security:#ec4899;
  /* 架构图配色（batch30，数据可视化豁免同 --ch-*）*/
  --arch-node-1:#eff6ff;
  --arch-node-2:#f5f3ff;
  --arch-node-3:#ecfeff;
  --arch-node-4:#fff7ed;
  --arch-node-5:#f0fdfa;
  --arch-node-6:#faf5ff;
  --arch-node-7:#fdf2f8;
  --arch-node-ink:#172033;
  --arch-edge:#cbd5e1;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Inter,sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
  --ok:var(--success);
  --info:#3565C0;
  --num:tabular-nums;
  --sh-sm:var(--shadow-card);
  --sh-md:var(--shadow-pop);
  --fs-xs:12px;
  --fs-sm:13px;
  --fs-base:14px;
  --fs-md:16px;
  --fs-lg:20px;
  --fs-xl:22px;
  --sp-1:4px;
  --sp-2:8px;
  --sp-3:12px;
  --sp-4:16px;
  --sp-5:24px;
  --sp-6:32px;
  --r-sm:6px;
  --r-md:12px;
  --r-lg:16px;
  --t-fast:120ms;
  --t-panel:220ms;
  --shadow-card:0 1px 2px rgba(16,14,10,.04),0 2px 8px rgba(16,14,10,.05);
  --shadow-pop:0 4px 16px rgba(16,14,10,.10),0 8px 32px rgba(16,14,10,.08);
  --hover:#F4EDE6;
}
/* 夜间皮肤 · AgentsRoom 渊蓝黑终端 —— 主线 client.ts loadTheme()/setTheme() 切 html[data-theme]，workbench 终端走同套 var 自动跟皮 */
html[data-theme="dark"] .kpi .chip{filter:brightness(1.85) saturate(1.15)}
html,body{height:100%}
body{font-family:var(--sans);background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;line-height:1.55;overflow:hidden;font-size:var(--fs-base)}
table,.kpi{font-variant-numeric:tabular-nums}
.num{font-variant-numeric:tabular-nums}
svg.i{width:19px;height:19px;flex-shrink:0;stroke:currentColor;stroke-width:1.7;fill:none;stroke-linecap:round;stroke-linejoin:round}
.app{display:flex;height:100vh;width:100%}
.rail{width:250px;background:var(--card);border-right:1px solid var(--line);display:flex;flex-direction:column;flex-shrink:0;padding:20px 14px;overflow-y:auto;overscroll-behavior:contain}
.brand{display:flex;align-items:center;gap:12px;padding:4px 8px 20px}
.brand .logo{width:42px;height:42px;border-radius:12px;background:transparent;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 8px rgba(8,58,76,.28)}
.brand .wm{font-size:18px;font-weight:800;letter-spacing:1.5px;color:var(--ink)}
.brand .sub2{font-size:10.5px;font-weight:600;letter-spacing:1px;color:var(--muted);margin-top:2px}
.kbar{display:flex;align-items:center;gap:9px;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:9px 11px;font-size:13px;color:var(--ink-2);margin-bottom:18px}
.kbar .kbd{margin-left:auto;font-size:10px;background:var(--card);border:1px solid var(--line);border-radius:5px;padding:2px 6px;color:var(--muted)}
#command-palette{position:fixed;inset:0;z-index:2000;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh}
#command-palette[hidden]{display:none}
.kp-command-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.38)}
.kp-command-panel{position:relative;width:min(560px,92vw);background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.22);overflow:hidden}
.kp-command-input{width:100%;box-sizing:border-box;border:none;border-bottom:1px solid var(--line);background:transparent;color:var(--ink);font-size:15px;padding:14px 16px;outline:none}
.kp-command-list{max-height:52vh;overflow-y:auto;padding:6px}
.kp-command-item{display:block;width:100%;text-align:left;background:transparent;border:none;border-radius:8px;padding:9px 12px;font-size:13.5px;color:var(--ink);cursor:pointer}
.kp-command-item:hover,.kp-command-item:focus{background:var(--primary-100);color:var(--primary)}
.ops-card,.kcard{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);box-shadow:var(--shadow-card);padding:14px 16px;margin:10px 0;min-width:0}
.ops-card-title{font-weight:600;font-size:var(--fs-base);margin-bottom:6px}
.ops-card-title a{color:var(--primary);text-decoration:none}
.ops-card-title a:hover{text-decoration:underline}
.ops-metrics{display:flex;flex-wrap:wrap;gap:12px;color:var(--muted);font-size:12.5px;margin-top:6px}
.ops-feedback{color:var(--muted-2);font-size:12.5px;margin-top:6px}
.ops-event,.ops-events{font-size:12.5px;color:var(--ink-2)}
.empty-state{text-align:center;color:var(--muted);padding:28px 16px;border:1px dashed var(--line);border-radius:var(--r-md);background:var(--card)}
.empty-title{font-weight:600;color:var(--ink-2);margin-bottom:4px}
.ipt{width:100%;box-sizing:border-box;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-size:13.5px;color:var(--ink);outline:none}
.ipt:focus{border-color:var(--primary-line)}
.btn{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-sm);color:var(--ink);background:var(--card);border:1px solid var(--line-2);border-radius:var(--r-sm);padding:7px 13px;cursor:pointer;font-weight:600;transition:background var(--t-fast) ease,border-color var(--t-fast) ease}
.btn:hover{background:var(--primary-100);border-color:var(--primary-line);color:var(--primary)}
.btn:active{transform:scale(.98)}
.btn:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.qa-evidence,.qa-problem,.preview-errors,.picked-elements,.version-spine,.ws-versions,.seo-hints,.ops-diff,.loop-usage{font-size:12.5px;color:var(--ink-2);margin:6px 0;line-height:1.6}
.qa-problem,.preview-errors{color:var(--danger)}
.ops-diff{font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace;font-size:12px;background:var(--primary-100);border:1px solid var(--line);border-radius:8px;padding:8px 10px;overflow-x:auto;white-space:pre}
.loop-usage{display:flex;flex-wrap:wrap;gap:10px;color:var(--muted)}
.nav-sec{font-size:10.5px;text-transform:uppercase;letter-spacing:1px;color:var(--ink-2);margin:18px 10px 7px}
.nav-item{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:9px;font-size:14px;color:var(--muted-2);cursor:pointer;margin-bottom:2px}
.nav-item:hover{background:var(--bg)}
.nav-item.active{background:var(--primary-soft);color:var(--primary);font-weight:600}
.nav-item .badge{margin-left:auto;background:var(--warn);color:var(--on-warn);font-size:11px;font-weight:700;border-radius:9px;padding:1px 8px}
.nav-item .dot{margin-left:auto;width:8px;height:8px;border-radius:50%}
.rail-foot{margin-top:auto;display:flex;align-items:center;gap:10px;padding:12px 8px 4px;border-top:1px solid var(--line);font-size:13px;color:var(--muted-2)}
.avatar{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#155E75,#22B8D4);display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;font-weight:600}
.canvas{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
/* #view 是 canvas 与各视图 .body 之间的中间层：必须撑成 flex 子+列容器并 min-height:0，
   否则 .body 的 overflow:auto 拿不到受限高度，内容超出视口时整页无法滚动（panel 落在折叠下方点不到）。 */
#view{flex:1;min-height:0;overflow:auto}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.topbar{display:flex;align-items:center;gap:13px;padding:18px 30px;border-bottom:1px solid var(--line);flex-shrink:0;background:var(--card)}
.topbar h1{font-size:var(--fs-xl);font-weight:680}
.crumb{color:var(--muted);font-size:13px}
.spacer{flex:1}
.kp-mode-strip{width:100%;height:6px;flex-shrink:0;background:transparent}
.kp-topbar{display:flex;align-items:center;gap:10px;margin:0 0 16px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--card);box-shadow:var(--shadow-card)}
.kp-topbar .kp-ws-label{font-size:12px;font-weight:700;color:var(--muted)}
.kp-topbar .spacer{flex:1}
.kp-topbar .kp-user{font-size:12px;color:var(--muted);white-space:nowrap}
.kp-topbar .kp-logout{border:1px solid var(--line);border-radius:var(--r-sm);padding:2px 8px;font-size:12px;color:var(--muted);white-space:nowrap;text-decoration:none;transition:color var(--t-fast),border-color var(--t-fast),background var(--t-fast)}
.kp-topbar .kp-logout:hover{color:var(--ink);border-color:var(--primary-line);background:var(--hover)}
.kp-mode{display:inline-flex;align-items:center;gap:7px;padding:3px 8px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--card)}
.kp-mode-dot{width:9px;height:9px;flex-shrink:0;border:1px solid var(--line);border-radius:50%;background:transparent}
.kp-mode-select{height:26px;border:0;background:var(--card);color:var(--ink);font:inherit;font-size:12px;cursor:pointer;outline:none}
.kp-ws-select{min-width:220px;max-width:100%;height:34px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--ink);font-size:14px;padding:0 10px}
.kp-status-pill{align-items:center;gap:12px;margin-right:12px;font-size:12.5px;white-space:nowrap}
.ghost-btn{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--muted-2);border:1px solid var(--line);background:var(--card);border-radius:9px;padding:8px 13px;cursor:pointer;font-weight:520}
.ghost-btn svg.i{width:15px;height:15px}
.body{padding:24px 30px;overflow:auto;flex:1}
.body table{display:block;max-width:100%;overflow-x:auto}
.body pre{max-width:100%;overflow-x:auto}
.body img,.body svg,.body video{max-width:100%}
.wrap{max-width:1280px;margin:0 auto}
.project-wrap{max-width:min(1760px,95vw)}
.card,.hero{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);box-shadow:var(--shadow-card)}
.card{min-width:0}
.hero{display:flex;align-items:stretch;gap:20px;overflow:hidden;position:relative}
.hero-text{padding:26px 28px;display:flex;flex-direction:column;justify-content:center;gap:12px;z-index:2}
.hero-badge{display:inline-flex;align-items:center;gap:7px;align-self:flex-start;background:var(--success-soft);border:1px solid var(--success-line);border-radius:999px;padding:5px 12px;font-size:12px;color:var(--success);font-weight:600}
.hero-badge .pdot{width:8px;height:8px;border-radius:50%;background:var(--success);box-shadow:0 0 0 4px rgba(22,163,74,.16)}
.hero-text h2{font-size:var(--fs-xl);font-weight:720;letter-spacing:.3px;line-height:1.25}
.hero-text .poem{color:var(--primary);font-size:13px;font-weight:540;letter-spacing:1.5px}
.hero-text .sub{color:var(--muted-2);font-size:13.5px}
.hero-art{flex:1;min-width:210px;position:relative;background:linear-gradient(120deg,var(--primary-soft),var(--primary-100) 62%,var(--card))}
.hero-art svg{position:absolute;inset:0;width:100%;height:100%}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:14px;margin:20px 0 4px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);padding:var(--sp-4) 18px;display:flex;align-items:center;gap:13px;box-shadow:var(--shadow-card);transition:transform var(--t-fast),box-shadow var(--t-fast)}
.kpi:hover{transform:translateY(-2px);box-shadow:var(--shadow-pop)}
.chip{border-radius:999px;display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:12px;font-weight:560}
.kpi .chip{width:42px;height:42px;border-radius:11px;flex-shrink:0}
.kpi .chip svg{width:21px;height:21px;stroke-width:1.85;fill:none;stroke-linecap:round;stroke-linejoin:round}
.kpi .n{font-size:28px;font-weight:720;letter-spacing:-.5px;line-height:1;color:var(--ink)}
.kpi .l{font-size:12px;margin-top:5px;color:var(--muted)}
.kpi.pri .chip{background:var(--primary-soft)}
.kpi.pri .chip svg{stroke:var(--primary)}
.kpi.wrn .chip{background:var(--warn-soft)}
.kpi.wrn .chip svg{stroke:var(--warn)}
.kpi.wrn .n{color:var(--warn)}
.kpi.suc .chip{background:var(--success-soft)}
.kpi.suc .chip svg{stroke:var(--success)}
.proj-usage-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);padding:18px 20px;box-shadow:var(--shadow-card)}
.proj-usage-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.proj-usage-total{font-size:30px;font-weight:720;letter-spacing:-.5px;line-height:1;color:var(--ink)}
.proj-model-bars{margin-top:14px;border-top:1px solid var(--line-2);padding-top:12px}
.proj-model-row{display:flex;align-items:center;gap:10px;margin:7px 0}
.proj-model-name{width:130px;flex-shrink:0;font-size:12.5px}
.proj-model-track{flex:1;height:8px;border-radius:5px;background:var(--line-2);overflow:hidden}
.proj-model-fill{display:block;height:100%;background:var(--primary);border-radius:5px;transition:width var(--t-panel) ease}
.proj-model-val{width:62px;text-align:right;font-size:12px}
.kpi.neu .chip{background:var(--bg)}
.kpi.neu .chip svg{stroke:var(--muted)}
.section-h{display:flex;align-items:center;gap:10px;margin:26px 2px 12px}
.section-h h3{font-size:var(--fs-md);font-weight:720;letter-spacing:-.2px;line-height:1.15;padding-left:10px;border-left:3px solid var(--primary)}
.section-h .hint{color:var(--muted);font-size:var(--fs-sm);font-weight:400}
.section-h .more{margin-left:auto;color:var(--primary);font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:4px;font-weight:540}
.runs{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;box-shadow:var(--shadow-card)}
.run{display:flex;align-items:center;gap:13px;padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--line);font-size:var(--fs-base);flex-wrap:wrap}
.run:hover{background:var(--hover)}
.run:last-child{border-bottom:none}
#kp-worker-machines .run{align-items:flex-start}
#kp-worker-machines .kp-worker-root{min-width:0;color:var(--muted);font-family:var(--mono);overflow-wrap:anywhere}
.kp-worker-revoke{margin-left:auto;background:var(--danger-soft);border-color:var(--danger-line);color:var(--danger)}
.kp-worker-unrevoke{margin-left:auto;background:var(--primary-soft);border-color:var(--primary-line);color:var(--primary)}
.tag{font-size:var(--fs-xs);border-radius:6px;padding:3px 9px;flex-shrink:0;font-weight:560;background:var(--bg);color:var(--ink-2);border:1px solid var(--line)}
.tag.tag-ok{background:var(--success-soft);color:var(--success);border-color:var(--success-line)}
.tag.tag-info{background:color-mix(in srgb,var(--info) 12%,transparent);color:var(--info);border-color:color-mix(in srgb,var(--info) 28%,transparent)}
.tag.tag-warn{background:var(--warn-soft);color:var(--warn);border-color:var(--warn-line)}
.tag.tag-danger{background:var(--danger-soft);color:var(--danger);border-color:var(--danger-line)}
.task-board .tb-kpis{margin:14px 0 8px}
.tb-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);box-shadow:var(--shadow-card);overflow-y:hidden;overflow-x:auto}
.tb-table{width:100%;border-collapse:collapse;font-size:13px}
.tb-table th{text-align:left;padding:11px 14px;font-size:11px;font-weight:640;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);background:var(--bg);border-bottom:1px solid var(--line)}
.tb-table th.num,.tb-table td.num{text-align:right;font-variant-numeric:tabular-nums}
.tb-table td{padding:11px 14px;border-bottom:1px solid var(--line-2);color:var(--ink-2);vertical-align:middle}
.tb-table tbody tr:last-child td{border-bottom:none}
.tb-table tbody tr{transition:background var(--t-fast)}
.tb-table tbody tr:hover{background:var(--bg)}
.tb-req{font-weight:560;color:var(--ink);max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle}
.tb-proj{font-size:11px;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:2px 8px;color:var(--muted)}
.tb-age{color:var(--muted);font-variant-numeric:tabular-nums}
.tb-empty{text-align:center;color:var(--muted);padding:32px 14px}
.lvl{font-size:11px;font-weight:680;border-radius:6px;padding:2px 8px;border:1px solid var(--line);background:var(--bg);color:var(--muted)}
.lvl-l3{background:var(--success-soft);color:var(--success);border-color:var(--success-line)}
.lvl-l2{background:var(--warn-soft);color:var(--warn);border-color:var(--warn-line)}
.lvl-l1{background:var(--primary-soft);color:var(--primary);border-color:var(--primary-line)}
.tb-checkup{display:flex;align-items:center;gap:8px;margin:2px 0 14px;flex-wrap:wrap}
.ck-label{font-size:11px;font-weight:640;color:var(--muted);letter-spacing:.3px}
.tb-bar{flex:1;min-width:120px;height:8px;border-radius:6px;overflow:hidden;display:flex;background:var(--bg);border:1px solid var(--line)}
.tb-bar i{display:block;height:100%}
.s-l3{background:var(--success)}
.s-l2{background:var(--warn)}
.s-l1{background:var(--primary)}
.ck-chip{font-size:11px;font-weight:640;border-radius:6px;padding:2px 8px;border:1px solid var(--line)}
.ck-l3{background:var(--success-soft);color:var(--success);border-color:var(--success-line)}
.ck-l2{background:var(--warn-soft);color:var(--warn);border-color:var(--warn-line)}
.ck-l1{background:var(--primary-soft);color:var(--primary);border-color:var(--primary-line)}
.tb-ratio{font-size:12px;font-weight:600;color:var(--ink-2);font-variant-numeric:tabular-nums}
.tag.tag-idle{background:var(--line-2);color:var(--muted);border-color:var(--line)}
.run .name{font-size:var(--fs-base);font-weight:560;flex-shrink:0}
.stage{font-size:var(--fs-sm);border-radius:6px;padding:3px 9px;flex-shrink:0;font-weight:560}
.stage.impl{background:var(--primary-soft);color:var(--primary)}
.stage.verify{background:var(--success-soft);color:var(--success)}
.bar{flex:1;height:7px;background:var(--line);border-radius:5px;overflow:hidden;min-width:90px}
.bar > i{display:block;height:100%;border-radius:5px;background:var(--primary)}
.pct{color:var(--muted);font-size:12px;width:38px;text-align:right;flex-shrink:0;font-weight:560}
.note{margin-top:16px;color:var(--muted-2);font-size:12.5px;display:flex;gap:8px;align-items:flex-start;line-height:1.6}
.note .ni{color:var(--warn);flex-shrink:0;margin-top:1px}
.note b{color:var(--ink);font-weight:600}
/* 项目视图（views/project.ts）：topbar 主按钮 / tab 条 / 开发流列表 / 状态药丸。
   与总览同源 token，补齐 cockpit-3 批次只落 class 名、漏写样式的缺口。 */
.btn-primary{display:inline-flex;align-items:center;gap:7px;font-size:var(--fs-sm);color:#fff;border:none;border-radius:var(--r-sm);padding:9px 16px;cursor:pointer;font-weight:600;background:var(--primary);transition:background var(--t-fast) ease,border-color var(--t-fast) ease,transform calc(var(--t-fast) / 2) ease}
.btn-primary:hover{background:var(--primary-2);transform:translateY(-1px)}
.btn-primary:active{transform:scale(.98)}
.btn-primary:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.btn-primary svg.i,.btn-primary .i{width:15px;height:15px;stroke:#fff}
.tabs{display:flex;gap:4px;padding:14px 30px 0;border-bottom:1px solid var(--line);flex-shrink:0;background:var(--card);flex-wrap:wrap}
.tab{padding:10px 14px;font-size:13.5px;color:var(--muted-2);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;font-weight:520;display:flex;align-items:center;gap:6px;text-decoration:none}
.tab:hover{color:var(--ink)}
.tab.active{color:var(--primary);border-bottom-color:var(--primary);font-weight:620}
.tab.future{color:var(--ink-2)}
.mini{font-size:10px;background:var(--bg);color:var(--ink-2);border-radius:5px;padding:0 5px;border:1px solid var(--line)}
.sec-h{display:flex;align-items:center;gap:10px;margin:26px 2px 12px}
.sec-h h3{font-size:var(--fs-md);font-weight:720;letter-spacing:-.2px;line-height:1.15;padding-left:10px;border-left:3px solid var(--primary)}
.sec-h .hint{color:var(--muted);font-size:var(--fs-sm)}
.sub-h{display:flex;align-items:center;gap:9px;margin:14px 2px 9px}
.sub-h .step{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 5px;border-radius:6px;background:var(--primary-soft);color:var(--primary);font-size:11px;font-weight:700}
.sub-h .step-t{font-size:13.5px;font-weight:640;color:var(--ink-2)}
.sub-h .hint{color:var(--muted);font-size:11.5px}
.flow-list{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;box-shadow:var(--shadow-card)}
.flow-row{display:flex;align-items:center;gap:13px;padding:15px 18px;border-bottom:1px solid var(--line);font-size:13.5px}
.flow-row:hover{background:var(--bg)}
.flow-row:last-child{border-bottom:none}
.flow-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.flow-title{font-weight:560;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.flow-row .meta{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.status{font-size:11.5px;border-radius:6px;padding:3px 9px;flex-shrink:0;font-weight:560;background:var(--bg);color:var(--ink-2);border:1px solid var(--line)}
.status.verified{background:var(--success-soft);color:var(--success);border-color:transparent}
.status.running{background:var(--primary-soft);color:var(--primary);border-color:transparent}
.status.rolled-back{background:var(--bg);color:var(--muted)}
.pick{margin-left:auto;font-size:12.5px;border:1px solid var(--line);background:var(--card);border-radius:8px;padding:6px 12px;cursor:pointer;color:var(--muted-2);font-weight:560}
.pick:hover{border-color:var(--primary);color:var(--primary)}
/* 开发流 · 流水线视图(每 flow 一条 spec→audit→implement→verify→commit) */
.flow-group{margin-bottom:18px}
.fg-head{display:flex;align-items:center;gap:10px;margin:0 2px 8px}
.fg-name{font-size:12px;font-weight:680;color:var(--ink-2)}
.fg-c{font-size:11px;color:var(--muted);background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:1px 9px}
.flow-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);padding:15px 16px;margin-bottom:10px;box-shadow:var(--shadow-card)}
.flow-card .fc-head{display:flex;align-items:center;gap:10px;margin-bottom:13px}
.fc-main{min-width:0;margin-right:auto}
.fc-title{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fc-id{font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pl{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.seg{display:flex;flex-direction:column;gap:5px;min-width:0}
.seg-top{display:flex;align-items:center;justify-content:space-between}
.seg-l{font-size:11px;font-weight:600;color:var(--muted-2);text-transform:uppercase;letter-spacing:.04em}
.seg-bar{height:6px;border-radius:3px;background:var(--line);transition:background var(--t-panel) ease}
.seg-meta{font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.seg.done .seg-bar{background:var(--success)}
.seg.done .seg-l{color:var(--success)}
.seg.act .seg-bar{background:var(--primary);animation:segpulse 1.6s ease-in-out infinite}
.seg.act .seg-l{color:var(--primary)}
.seg.blk .seg-bar{background:var(--danger)}
.seg.blk .seg-l{color:var(--danger)}
.seg.roll .seg-bar{background:var(--warn)}
.seg.pend .seg-bar{background:var(--line)}
.seg.pend .seg-l{color:var(--muted)}
@keyframes segpulse{0%,100%{opacity:1}50%{opacity:.45}}
.fc-alert{margin-top:11px;font-size:12px;font-weight:500;border-radius:9px;padding:8px 11px}
.fc-alert.blk{background:var(--danger-soft);color:var(--danger);border:1px solid var(--danger)}
.fc-alert.gate{background:var(--warn-soft);color:var(--warn);border:1px solid var(--warn)}
/* 项目视图 · 方案 tab（plan-* 由 project.ts 自造，design-system 无对应，按 flow-* 同构写） */
.project-summary{display:flex;gap:12px;flex-wrap:wrap;margin:4px 2px 18px}
.plan-list{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;box-shadow:var(--shadow-card)}
.plan-row{display:flex;align-items:center;gap:13px;padding:15px 18px;border-bottom:1px solid var(--line);font-size:13.5px}
.plan-row:hover{background:var(--bg)}
.plan-row:last-child{border-bottom:none}
.plan-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.plan-desc{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plan-start{margin-left:auto}
.plan-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.plan-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);padding:15px;box-shadow:var(--shadow-card);transition:transform var(--t-fast),box-shadow var(--t-fast),border-color var(--t-fast)}
.plan-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-pop);border-color:var(--primary-soft)}
.pc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}
.pc-title{font-size:14px;font-weight:650;color:var(--ink);line-height:1.35;min-width:0}
.pc-summary{font-size:12.5px;color:var(--muted);line-height:1.55;min-height:38px;margin-bottom:14px}
.pc-foot{display:flex;align-items:center;gap:9px;border-top:1px solid var(--line);padding-top:11px}
.pc-id{font-size:11.5px;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pc-seg{font-size:11.5px;color:var(--muted-2);white-space:nowrap;margin-left:auto}
.pc-foot .pick{flex-shrink:0}
.merged{font-size:11px;font-weight:600;border-radius:7px;padding:3px 9px;background:var(--success-soft);color:var(--success);flex-shrink:0}
.project-empty,.inbox-empty{color:var(--muted);font-size:13px;text-align:center;padding:40px 18px;background:var(--card);border:1px solid var(--line);border-radius:14px}
/* 项目视图 · 设计 tab（设计候选卡片，源自 design-system/project-design.html） */
.cands{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
.cand{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;box-shadow:var(--shadow-card);transition:transform var(--t-fast),box-shadow var(--t-fast)}
.cand:hover{transform:translateY(-3px);box-shadow:var(--shadow-pop)}
.cand.sel{border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-soft),var(--sh-md)}
.cand-img{width:100%;height:150px;object-fit:cover;display:block;background:var(--bg)}
.prev{height:150px;padding:14px;position:relative}
.prev .ph{height:9px;border-radius:4px;background:rgba(15,23,42,.07);margin-bottom:7px}
.prev .pcard{position:absolute;left:14px;right:14px;bottom:14px;height:46px;border-radius:9px;background:#fff;box-shadow:0 6px 16px -8px rgba(15,23,42,.3);display:flex;align-items:center;gap:8px;padding:0 12px}
.prev .pbtn{width:42px;height:16px;border-radius:5px;background:var(--primary-soft)}
.cand-foot{display:flex;align-items:center;gap:10px;padding:13px 16px;border-top:1px solid var(--line)}
.cand-foot .nm{font-weight:600;font-size:13.5px}
.cand-foot .meta{font-size:11.5px;color:var(--muted)}
.selbadge{margin-left:auto;display:flex;align-items:center;gap:10px}
.selbadge .tick{display:flex;align-items:center;gap:5px;color:var(--success);font-size:12.5px;font-weight:620}
.gen{font-size:12.5px;color:#fff;border:none;border-radius:8px;padding:7px 13px;cursor:pointer;font-weight:600;background:var(--primary)}
.gen:hover{background:var(--primary-2)}
/* —— 设计 tab：tier-gate 出门裁决（设计轨增量，应设计 chat 请求接入） —— */
.gate-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px}
.gate-pill{font-size:11.5px;font-weight:560;border-radius:6px;padding:3px 9px;border:1px solid transparent}
.gate-pill.gate-pass{background:var(--success-soft);color:var(--success)}
.gate-pill.gate-review{background:var(--warn-soft);color:var(--warn)}
.gate-pill.gate-block{background:var(--danger-soft);color:var(--danger)}
.sig{font-size:11px;font-weight:540;border-radius:5px;padding:2px 7px;border:1px solid var(--line);color:var(--muted)}
.sig.sig-ok{color:var(--success);border-color:var(--success-line)}
.sig.sig-bad{color:var(--danger);border-color:var(--danger-line)}
.gate-blockers{color:var(--danger);font-size:11.5px;font-weight:500}
/* 产品 tab：DEFINE 访谈 + 产品定义（设计/产品轨请求接入） */
.interview{display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid var(--line);border-radius:10px}
.iv-progress{color:var(--muted);font-size:12px;font-weight:560}
.iv-q{font-size:15px;font-weight:640;color:var(--ink)}
.iv-input{padding:9px 12px;border:1px solid var(--line);border-radius:8px;font-size:13.5px;font-family:var(--sans)}
.pdef{display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid var(--line);border-radius:10px}
.pdef-row{display:flex;gap:12px;align-items:flex-start}
.pdef-k{font-weight:620;color:var(--muted);font-size:12.5px;min-width:48px;flex-shrink:0}
.pdef-v{font-size:13.5px;color:var(--ink)}
.step-bar{display:flex;gap:8px;margin:8px 0}
.step-cell{padding:4px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px;opacity:.6}
.step-cell.drafted{opacity:1}
.step-cell.accepted{opacity:1;border-color:var(--ok)}
.step-cell.cur{font-weight:600;box-shadow:0 0 0 2px var(--primary) inset}
/* 待我处理 inbox · 控制门卡片 + 动作按钮（源自 design-system/inbox.html） */
.inbox-wrap{max-width:880px;margin:0 auto}
.lead{color:var(--muted-2);font-size:13px;background:var(--primary-soft);border:1px solid var(--primary-line);border-radius:12px;padding:13px 16px;display:flex;gap:8px;align-items:flex-start;line-height:1.6;margin-bottom:16px}
.lead b{color:var(--ink)}
.cnt{background:var(--warn);color:var(--on-warn);font-size:12px;font-weight:700;border-radius:9px;padding:1px 9px}
.gate{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);box-shadow:var(--shadow-card);overflow:hidden;margin-bottom:14px}
.gate-h{display:flex;align-items:center;gap:12px;padding:15px 18px}
.gchip{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.gchip.m{background:var(--success-soft)}
.gchip.m svg{stroke:var(--success)}
.gchip.p{background:var(--warn-soft)}
.gchip.p svg{stroke:var(--warn)}
.gchip svg{width:20px;height:20px;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.gate-h .ti{font-weight:620;font-size:14px}
.gate-h .mt{font-size:12px;color:var(--muted);margin-top:2px}
.gate-kind{margin-left:auto;font-size:11px;font-weight:600;border-radius:7px;padding:3px 9px}
.gate-kind.m{background:var(--success-soft);color:var(--success)}
.gate-kind.p{background:var(--warn-soft);color:var(--warn)}
.gate-b{padding:14px 18px 16px;border-top:1px solid var(--line)}
.ruletxt{font-size:12.5px;color:var(--muted-2);background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:10px 13px}
.acts{display:flex;gap:9px;margin-top:14px;flex-wrap:wrap}
.b{font-size:var(--fs-sm);border-radius:var(--r-sm);padding:8px 15px;cursor:pointer;font-weight:600;border:1px solid transparent;text-decoration:none;display:inline-flex;align-items:center;gap:6px;transition:background var(--t-fast) ease,border-color var(--t-fast) ease,transform calc(var(--t-fast) / 2) ease}
.b:hover{transform:translateY(-1px)}
.b:active{transform:scale(.98)}
.b:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.b.gh{background:var(--card);border-color:var(--line);color:var(--muted-2);font-weight:540}
.b.ok{background:var(--success);color:#fff}
.b.pri{background:var(--primary);color:#fff}
.b.dn{background:transparent;border-color:var(--danger-line);color:var(--danger);font-weight:540}
/* 运营 loop 专页：复用 runs/run 面板骨架，只补 loop 专属布局与 next 高亮。 */
.loop-wrap{display:flex;flex-direction:column;gap:2px}
.loop-card{margin-bottom:26px}
.loop-panel{margin-bottom:4px}
.loop-overview{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:16px 18px}
.loop-metric{display:flex;flex-direction:column;gap:3px;min-width:150px}
.loop-value{font-size:28px;font-weight:720;line-height:1;color:var(--primary)}
.loop-trend{display:flex;align-items:flex-end;gap:6px;min-height:36px;flex:1;min-width:180px}
.loop-trend-point{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:28px;border-radius:8px;background:var(--primary-soft);border:1px solid var(--primary-line);color:var(--primary);font-size:12px;font-weight:650}
.loop-trend-empty{color:var(--muted);font-size:12px}
.loop-judgment{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:4px}
.loop-judgment-line{font-size:13px;color:var(--ink);line-height:1.5}
.loop-wave{display:flex;align-items:center;gap:11px;padding:14px 18px;border-bottom:1px solid var(--line);font-size:13.5px;flex-wrap:wrap}
.loop-wave:hover{background:var(--hover)}
.loop-wave:last-child{border-bottom:none}
.loop-subject{flex:1;min-width:160px;color:var(--ink);font-weight:540}
.loop-levers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0}
.loop-lever-col{padding:14px 16px;border-right:1px solid var(--line);min-width:0}
.loop-lever-col:last-child{border-right:none}
.loop-lever-title{font-size:12px;font-weight:680;color:var(--muted);margin-bottom:10px}
.loop-lever{display:flex;align-items:center;gap:8px;justify-content:space-between;border:1px solid var(--line);border-radius:10px;padding:9px 10px;margin-bottom:8px;background:var(--card);font-size:13px}
.loop-lever-next{border-color:var(--primary-line);background:var(--primary-soft);box-shadow:0 0 0 2px var(--primary-soft)}
.loop-bullet{width:8px;height:8px;border-radius:50%;background:var(--primary);flex-shrink:0}
/* 通用小类 */
.muted{color:var(--muted)}
.run.empty,.empty{color:var(--muted);justify-content:center}
.dot-success{background:var(--success)}
.dot-primary{background:var(--primary)}
.dot-danger{background:var(--danger)}
.sb-alert{border:1px solid var(--danger);background:var(--danger-soft);border-radius:12px;padding:12px 14px;margin-bottom:6px}
.sb-alert-h{display:flex;align-items:center;font-weight:720;color:var(--danger);font-size:14px;margin-bottom:8px}
.sb-ok{display:flex;align-items:center;color:var(--muted);font-size:13px;padding:8px 2px}
.run.sb-urgent{border-left:3px solid var(--danger)}
.gate-diag{display:inline-flex;align-items:center;gap:6px;margin-left:8px}
.diag{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;border-radius:9px;padding:2px 9px}
.diag .dot{position:static;width:7px;height:7px}
.diag-ok{background:var(--success-soft);color:var(--success)}
.diag-warn{background:var(--warn-soft);color:var(--warn)}
.diag-ghost{background:var(--line-2);color:var(--muted)}
.diag-missing{background:var(--danger-soft);color:var(--danger)}
@media (max-width:1100px){.pl{grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}}
@media (max-width: 920px){
  .rail{width:64px;padding:18px 9px;align-items:center}
  .rail .lbl,.kbar .lbl,.nav-sec,.nav-item .badge,.rail-foot .lbl,.rail-foot .spacer,.rail-foot span:last-child,.kbar .kbd{display:none}
  .kbar{justify-content:center}
  .nav-item{justify-content:center;gap:0}
  .nav-item .dot{position:absolute;transform:translate(12px,-12px)}
  .brand{justify-content:center;gap:0}
}
@media (max-height: 700px){.rail{padding-top:12px}.brand{padding-bottom:10px}.kbar{margin-bottom:10px}}
@media (max-width: 760px){.loop-levers{grid-template-columns:1fr}.loop-lever-col{border-right:none;border-bottom:1px solid var(--line)}.loop-lever-col:last-child{border-bottom:none}}
@media (max-width: 680px){.hero-art{display:none}}
@media (max-width: 600px){.topbar{padding:14px 16px}.body{padding:16px}.hero-text{padding:22px}.hero-text h2{font-size:21px}}
.arch-layout-toggle{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin:2px 0 8px;color:var(--muted)}
.arch-layout-label{font-size:12px;margin-right:4px;color:var(--muted)}
.arch-layout-btn{border:1px solid var(--line);background:var(--card);color:var(--muted);border-radius:var(--r-sm);padding:4px 10px;font:inherit;font-size:12px;cursor:pointer}
.arch-layout-btn:hover,.arch-layout-btn.active{border-color:var(--warn);color:var(--ink);background:var(--bg)}
.arch-layer-band{background:var(--card);border-color:var(--line);color:var(--muted)}
.arch-dim{opacity:.15}
.arch-focus{opacity:1}
html[data-theme="dark"]{
  --bg:#0B1220;
  --card:#111A2C;
  --line:#1E2A40;
  --line-2:#334155;
  --ink:#E6EDF6;
  --ink-2:#9FB0C6;
  --muted:#94A3B8;
  --muted-2:#B5C3D4;
  --primary:#22B8D4;
  --primary-2:#38C6E0;
  --on-primary:#0B1220;
  --primary-soft:#0E2233;
  --primary-100:#12314A;
  --primary-line:#1C4A63;
  --success:#3FB77B;
  --success-soft:#0F2419;
  --success-line:#1D4A32;
  --warn:#F59E0B;
  --on-warn:#0B1220;
  --warn-soft:#2A1F0C;
  --danger:#F2726A;
  --danger-soft:#2A1210;
  --danger-line:#4A211E;
  --warn-line:#4A3813;
  --term-bg:#070B12;
  --term-fg:#E6EDF6;
  --term-tab-bg:#111A2C;
  --term-tab-active-bg:#070B12;
  --term-tab-fg:#E6EDF6;
  --term-tab-border:#334155;
  --toast-bg:#E6EDF6;
  --toast-fg:#0B1220;
  --ch-ears:#60a5fa;
  --ch-official:#a78bfa;
  --ch-module:#22d3ee;
  --ch-security:#f472b6;
  /* 架构图配色（batch30，数据可视化豁免同 --ch-*）*/
  --arch-node-1:#16283f;
  --arch-node-2:#261c45;
  --arch-node-3:#123841;
  --arch-node-4:#3d2816;
  --arch-node-5:#123b35;
  --arch-node-6:#2e1f45;
  --arch-node-7:#3d1c32;
  --arch-node-ink:#E6EDF6;
  --arch-edge:#33415C;
  --info:#7AA2E8;
  --shadow-card:0 1px 2px rgba(0,0,0,.35),0 2px 10px rgba(0,0,0,.28);
  --shadow-pop:0 4px 18px rgba(0,0,0,.50),0 10px 36px rgba(0,0,0,.42);
  --hover:rgba(230,237,246,.05);
}
.theme-toggle{display:inline-flex;background:var(--line-2);border:1px solid var(--line);border-radius:999px;padding:3px;gap:2px}
.theme-toggle button{border:0;background:transparent;color:var(--muted-2);font:inherit;font-size:12px;padding:4px 11px;border-radius:999px;cursor:pointer;display:flex;align-items:center;gap:5px;line-height:1}
html:not([data-theme="dark"]) .theme-toggle button[data-theme-set="light"],html[data-theme="dark"] .theme-toggle button[data-theme-set="dark"]{background:var(--card);color:var(--ink);box-shadow:var(--sh-sm);font-weight:600}

/* ===== 自进化页 · bento（全部作用域在 .evo-bento 下，避免污染全局 .kpi/.chip/.hero 等）===== */
.evo-bento .bento{display:grid;grid-template-columns:repeat(12,1fr);gap:16px;grid-auto-flow:row dense}
.evo-bento .tile{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);box-shadow:var(--shadow-card);padding:18px 19px;position:relative;overflow:hidden;transition:box-shadow var(--t-panel) ease,transform var(--t-panel) ease,border-color var(--t-panel) ease}
.evo-bento .tile.big{border-radius:var(--r-lg);box-shadow:var(--shadow-pop)}
.evo-bento .tile:hover{box-shadow:var(--shadow-pop);transform:translateY(-2px)}
.evo-bento .tlabel{font-size:10.5px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-weight:600;margin:0 0 12px;display:flex;align-items:center;gap:8px}
.evo-bento .tlabel .star{color:var(--primary)}
.evo-bento .tlabel .badge{margin-left:auto;background:var(--primary-soft);color:var(--primary);border-radius:999px;font-size:10px;font-weight:700;letter-spacing:0;padding:2px 8px;text-transform:none;border:1px solid var(--primary-line)}
.evo-bento .c2{grid-column:span 2}.evo-bento .c3{grid-column:span 3}.evo-bento .c4{grid-column:span 4}.evo-bento .c5{grid-column:span 5}.evo-bento .c8{grid-column:span 8}.evo-bento .c12{grid-column:span 12}
.evo-bento .row-tall{grid-row:span 2}
.evo-bento .hero-tile{background:radial-gradient(120% 140% at 100% 0%,var(--primary-soft) 0%,transparent 55%),var(--card)}
.evo-bento .hero-tile .tlabel .star{font-size:13px}
.evo-bento .hero-num{font-size:44px;font-weight:720;letter-spacing:-.5px;line-height:1;margin:2px 0 6px;color:var(--ink)}
.evo-bento .hero-num .u{font-size:21px;font-weight:600;color:var(--muted);letter-spacing:0;margin-left:3px}
.evo-bento .delta{display:inline-flex;align-items:center;gap:4px;font-weight:650;font-size:12px;padding:3px 9px;border-radius:999px}
.evo-bento .delta.up{background:var(--success-soft);color:var(--success)}
.evo-bento .hero-spark{margin:16px 0 10px}
.evo-bento .hero-def{font-size:11.5px;color:var(--muted);line-height:1.5;border-top:1px solid var(--line);padding-top:11px}
.evo-bento .hero-def code{background:var(--bg);padding:1px 6px;border-radius:5px;font-size:11px;color:var(--ink-2)}
.evo-bento .kp-num{font-size:28px;font-weight:720;letter-spacing:-.5px;line-height:1.05;margin:2px 0 4px;color:var(--ink)}
.evo-bento .kp-num .u{font-size:14px;font-weight:600;color:var(--muted);margin-left:1px}
.evo-bento .kp-cap{font-size:11px;color:var(--muted)}
.evo-bento .chan{padding-left:21px}
.evo-bento .chan::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--cc)}
.evo-bento .chan .ch-head{display:flex;align-items:center;gap:8px;margin-bottom:9px}
.evo-bento .chan .ch-ico{width:26px;height:26px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--cc) 14%,transparent);color:var(--cc)}
.evo-bento .chan .ch-name{font-size:12.5px;font-weight:650;letter-spacing:-.1px;color:var(--ink)}
.evo-bento .chan .ch-name small{font-weight:500;color:var(--muted);font-size:10.5px;letter-spacing:0}
.evo-bento .fdot{width:8px;height:8px;border-radius:50%;margin-left:auto}
.evo-bento .fdot.live{background:var(--cc)}
.evo-bento .fdot.ok{background:var(--success)}
.evo-bento .fdot.stale{background:var(--warn)}
.evo-bento .chan .ch-count{font-size:30px;font-weight:720;letter-spacing:-.5px;line-height:1;display:flex;align-items:baseline;gap:6px;color:var(--ink)}
.evo-bento .chan .ch-count .tr{font-size:13px;font-weight:650}
.evo-bento .chan .ch-foot{font-size:10.5px;color:var(--muted);margin-top:8px;display:flex;align-items:center;gap:6px}
.evo-bento .chan .ch-foot .ld{width:6px;height:6px;border-radius:50%;background:var(--cc)}
.evo-bento .chan-spark{margin-top:6px}
.evo-bento .prop-list{display:flex;flex-direction:column}
.evo-bento .prow{display:grid;grid-template-columns:3px 1fr auto;gap:13px;align-items:center;padding:11px 4px 11px 0;border-top:1px solid var(--line);position:relative;transition:background var(--t-fast) ease}
.evo-bento .prow:first-of-type{border-top:none}
.evo-bento .prow:hover{background:var(--hover)}
.evo-bento .prow .acc{width:3px;height:34px;border-radius:3px;background:var(--cc);align-self:center}
.evo-bento .prow .mid{min-width:0}
.evo-bento .prow .pid{font-size:11px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums;letter-spacing:.2px}
.evo-bento .prow .psum{font-size:13px;font-weight:550;color:var(--ink);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.evo-bento .chips{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}
.evo-bento .chip{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap}
.evo-bento .chip.tested{background:var(--success-soft);color:var(--success)}
.evo-bento .chip.untested{background:transparent;color:var(--muted);border:1px solid var(--line)}
.evo-bento .chip.downgraded{background:var(--warn-soft);color:var(--warn)}
.evo-bento .chip.metric{background:var(--bg);color:var(--ink-2);font-variant-numeric:tabular-nums;font-weight:600}
.evo-bento .chip.metric.pos{color:var(--success)}.evo-bento .chip.metric.neg{color:var(--danger)}
.evo-bento .gdot{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:600;color:var(--muted)}
.evo-bento .gdot .d{width:7px;height:7px;border-radius:50%;background:var(--muted)}
.evo-bento .gdot.pass .d{background:var(--success)}.evo-bento .gdot.pass{color:var(--success)}
.evo-bento .gdot.fail .d{background:var(--danger)}.evo-bento .gdot.fail{color:var(--danger)}
.evo-bento .prow .right{display:flex;align-items:center;gap:10px}
.evo-bento .age{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;min-width:26px;text-align:right}
.evo-bento .btn-appr{height:28px;padding:0 13px;border-radius:var(--r-sm);border:1px solid var(--primary-line);background:var(--primary-soft);color:var(--primary);font-size:var(--fs-xs);font-weight:650;cursor:pointer;transition:background var(--t-fast) ease,transform var(--t-fast) ease}
.evo-bento .btn-appr:hover{background:var(--primary-100)}
.evo-bento .btn-more{width:28px;height:28px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--muted);cursor:pointer;font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
.evo-bento .btn-more:hover{background:var(--bg)}
.evo-bento .prop-foot{margin-top:12px;font-size:12px}
.evo-bento .prop-foot a{color:var(--primary);text-decoration:none;font-weight:600}
.evo-bento .fit-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}
.evo-bento .fit-base{font-size:12px;color:var(--muted)}
.evo-bento .fit-base b{color:var(--ink);font-weight:650}
.evo-bento .bullet{position:relative;height:26px;border-radius:8px;background:var(--bg);margin:22px 0 14px;border:1px solid var(--line)}
.evo-bento .bullet .cand{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,var(--primary-2),var(--primary));border-radius:8px}
.evo-bento .bullet .tick{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--ink-2);border-radius:1px;z-index:3}
.evo-bento .fit-deltas{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:6px}
.evo-bento .fit-note{font-size:11px;color:var(--muted)}
.evo-bento .fit-note b.g{color:var(--success)}
.evo-bento .hm-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:11px}
.evo-bento .hm{display:flex;flex-direction:column;gap:3px}
.evo-bento .hm .hm-n{font-size:17px;font-weight:720;letter-spacing:-.3px;line-height:1;color:var(--ink)}
.evo-bento .hm .hm-l{font-size:10px;color:var(--muted);font-weight:500}
.evo-bento .hm-cap{font-size:11px;color:var(--muted);border-top:1px solid var(--line);padding-top:10px;display:flex;align-items:center;gap:7px}
.evo-bento .hm-cap .shield{color:var(--primary)}
.evo-bento .tl-day{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin:6px 0 9px}
.evo-bento .tl{position:relative;padding-left:18px}
.evo-bento .tl::before{content:"";position:absolute;left:5px;top:4px;bottom:4px;width:2px;background:var(--line)}
.evo-bento .tl-item{position:relative;padding:0 0 15px}
.evo-bento .tl-item:last-child{padding-bottom:0}
.evo-bento .tl-item::before{content:"";position:absolute;left:-16px;top:4px;width:9px;height:9px;border-radius:50%;background:var(--card);border:2px solid var(--cc,var(--muted))}
.evo-bento .tl-item.appr::before{border-color:var(--success);background:var(--success)}
.evo-bento .tl-txt{font-size:12px;color:var(--ink);line-height:1.4}
.evo-bento .tl-txt b{font-weight:650}
.evo-bento .tl-txt .code{font-weight:700;color:var(--ink-2);font-variant-numeric:tabular-nums}
.evo-bento .tl-time{font-size:10.5px;color:var(--muted);margin-top:2px}
.evo-bento .empty-note{font-size:12px;color:var(--muted);line-height:1.55;background:var(--bg);border:1px dashed var(--line);border-radius:10px;padding:14px 15px}
.evo-bento .empty-note a{color:var(--primary);text-decoration:none;font-weight:600}
.evo-bento .live-dot{animation:evoPulse 2.2s infinite}
@keyframes evoPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--cc) 45%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
@media (max-width:1180px){.evo-bento .bento{grid-template-columns:repeat(6,1fr)}.evo-bento .c2,.evo-bento .c3{grid-column:span 3}.evo-bento .c4,.evo-bento .c5,.evo-bento .c8{grid-column:span 6}.evo-bento .row-tall{grid-row:auto}}
@media (prefers-reduced-motion:reduce){.evo-bento *{animation:none !important;transition:none !important}}
.kp-tabbar,.kp-more-sheet,.kp-more-backdrop{display:none}
.kp-more-toggle{position:fixed;left:-9999px;opacity:0;pointer-events:none}
@media (max-width:768px){
  body{overflow:hidden}
  .app{height:100dvh;min-height:100vh}
  .rail{display:none}
  .canvas{width:100%;padding-bottom:calc(68px + env(safe-area-inset-bottom));min-width:0}
  .canvas{padding-top:calc(14px + env(safe-area-inset-top))}
  #view{min-width:0}
  .topbar{padding:14px 16px}
  .topbar h1{font-size:16px}
  .body{padding:16px}
  .wrap,.project-wrap,.inbox-wrap{max-width:none;width:100%}
  .hero{border-radius:var(--r-md)}
  .hero-text{padding:20px}
  .hero-text h2{font-size:21px}
  .kpis,.plan-cards,.cands{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .pl,.loop-levers,.evo-bento .bento{grid-template-columns:1fr}
  .evo-bento .c2,.evo-bento .c3,.evo-bento .c4,.evo-bento .c5,.evo-bento .c8,.evo-bento .c12{grid-column:span 1}
  .run,.flow-row,.plan-row,.loop-wave{align-items:flex-start}
  .kp-tabbar{position:fixed;left:0;right:0;bottom:0;z-index:80;display:grid;grid-template-columns:repeat(5,1fr);gap:2px;padding:7px 8px calc(7px + env(safe-area-inset-bottom));background:color-mix(in srgb,var(--card) 94%,transparent);border-top:1px solid var(--line);box-shadow:0 -10px 30px -22px rgba(15,23,42,.55);backdrop-filter:blur(14px)}
  .kp-tab{position:relative;display:flex;min-width:0;height:50px;align-items:center;justify-content:center;flex-direction:column;gap:3px;border-radius:8px;color:var(--muted-2);font-size:10.5px;font-weight:620;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
  .kp-tab svg.i{width:20px;height:20px}
  .kp-tab.active{background:var(--primary-soft);color:var(--primary)}
  .kp-tab-badge{position:absolute;top:5px;right:16%;min-width:17px;height:17px;padding:0 5px;border-radius:999px;background:var(--warn);color:var(--on-warn);font-size:10px;line-height:17px;text-align:center}
  .kp-more-sheet{position:fixed;left:12px;right:12px;bottom:calc(78px + env(safe-area-inset-bottom));z-index:90;display:block;max-height:min(58vh,420px);overflow:auto;padding:14px;background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);box-shadow:var(--shadow-pop);transform:translateY(14px);opacity:0;pointer-events:none;transition:opacity var(--t-panel) ease,transform var(--t-panel) ease}
  .kp-more-title{font-size:12px;font-weight:720;color:var(--muted);margin:0 2px 10px}
  .kp-more-link{display:flex;align-items:center;gap:11px;min-height:42px;padding:9px 10px;border-radius:9px;color:var(--ink-2);font-size:14px;font-weight:560;text-decoration:none}
  .kp-more-link svg.i{width:19px;height:19px}
  .kp-more-link.active,.kp-more-link:hover{background:var(--primary-soft);color:var(--primary)}
  .kp-more-backdrop{position:fixed;inset:0;z-index:85;background:rgba(15,23,42,.24)}
  .kp-more-toggle:checked ~ .kp-more-backdrop{display:block}
  .kp-more-toggle:checked ~ .kp-more-sheet{opacity:1;transform:translateY(0);pointer-events:auto}
  .kp-topbar{flex-wrap:wrap;gap:8px;padding:9px 11px}
  .kp-topbar .kp-ws-label{order:-1}
  .kp-ws-select{min-width:0;flex:1 1 140px}
  .kp-topbar .spacer{display:none}
  .kp-status-pill{white-space:nowrap;margin-right:0}
  .kp-topbar .kp-user{max-width:150px;overflow:hidden;text-overflow:ellipsis}
  .kp-topbar .kp-logout{padding:2px 6px}
  .sel,input.name,input[type=text],input[type=search],input[type=password]{min-height:36px}
  summary.section-h{min-height:36px;display:flex;align-items:center}
  .theme-toggle button{min-height:32px;padding:6px 12px}
  label.muted{min-height:34px}
}
@media (max-width:520px){
  .kpis,.plan-cards,.cands{grid-template-columns:1fr}
  .run,.flow-row,.plan-row{gap:9px}
  .project-summary{display:grid;grid-template-columns:1fr 1fr}
  .theme-toggle button{padding:4px 8px}
}
.er-panel{color:var(--muted);font-size:13px;padding:4px 2px}
.action-inbox{margin-bottom:18px}
.proj-lights{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px}
.gate-calm{background:var(--success-soft);border:1px solid var(--success-line);border-radius:12px;padding:16px 18px;color:var(--ink)}
.more-metrics{margin-top:18px;border-top:1px solid var(--line);padding-top:8px}
.more-metrics>summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--muted-2);padding:8px 2px;list-style:none}
/* 流轨迹详情：结构、状态色与反馈控件均由双皮 token 驱动。 */
.kp-traj-head{margin-bottom:10px;color:var(--muted);font-size:12.5px}
.kp-traj-status{color:var(--kp-traj-color,var(--muted))}
.kp-traj-alert{margin-top:4px;color:var(--warn)}
.kp-traj-timeline{display:flex;flex-direction:column}
.kp-traj-row{display:flex;align-items:flex-start;gap:10px;padding:6px 0}
.kp-traj-track{display:flex;align-items:center;flex-direction:column;align-self:stretch}
.kp-traj-dot{width:9px;height:9px;margin-top:4px;border-radius:50%;background:var(--kp-traj-color,var(--muted));flex-shrink:0}
.kp-traj-dot.is-running,.kp-traj-status.is-running{--kp-traj-color:var(--info)}
.kp-traj-dot.is-verified,.kp-traj-status.is-verified{--kp-traj-color:var(--success)}
.kp-traj-dot.is-failed,.kp-traj-status.is-failed{--kp-traj-color:var(--danger)}
.kp-traj-dot.is-muted,.kp-traj-status.is-muted{--kp-traj-color:var(--muted)}
.kp-traj-line{width:2px;min-height:14px;margin-top:2px;flex:1;background:var(--line)}
.kp-traj-content{min-width:0;flex:1}
.kp-traj-stage{font-weight:600}
.kp-traj-meta{color:var(--muted);font-size:11.5px}
.kp-traj-empty{color:var(--muted)}
.kp-traj-feedback{margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
.kp-traj-feedback-title{margin-bottom:6px;font-weight:600}
.kp-traj-feedback-help{margin-bottom:6px;color:var(--muted);font-size:11.5px}
.kp-traj-feedback-input{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:6px;padding:8px;background:var(--card);color:var(--ink);font:12px/1.5 var(--mono)}
.kp-traj-feedback-actions{display:flex;align-items:center;gap:8px;margin-top:8px}
.kp-traj-feedback-message{color:var(--muted);font-size:12px}
/* 审批/差分复核卡会渲染在 overlay 内，因此在全局主题中统一样式。 */
.kp-diff-card{display:flex;flex-direction:column;gap:12px;padding:16px;background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);box-shadow:var(--shadow-card);color:var(--ink)}
.kp-diff-head{font-size:var(--fs-md);font-weight:720;color:var(--ink);word-break:break-word}
.kp-diff-prereview{display:flex;align-items:flex-start;gap:8px;color:var(--ink-2)}
.kp-diff-files{display:flex;flex-direction:column;gap:12px;min-width:0}
.kp-diff-file{overflow:hidden;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--card)}
.kp-diff-file-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--bg);color:var(--ink);font:650 var(--fs-sm)/1.4 var(--mono)}
.kp-diff-file-head button,.kp-diff-actions button{padding:6px 10px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--card);color:var(--ink-2);font:600 var(--fs-xs)/1.4 var(--sans);cursor:pointer}
.kp-diff-file-head button:hover,.kp-diff-actions button:hover{border-color:var(--primary-line);background:var(--primary-soft);color:var(--primary)}
.kp-diff-body{max-width:100%;margin:0;padding:12px;overflow:auto;border:1px solid var(--line);background:var(--bg);color:var(--ink-2);font:var(--fs-xs)/1.6 var(--mono);white-space:pre}
.kp-diff-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:var(--fs-xs)}
.kp-gc-editor{padding:10px;border-bottom:1px solid var(--line);background:var(--card);color:var(--ink-2)}
.kp-gc-comments{display:flex;flex-direction:column;gap:6px;padding:0 10px;background:var(--card);color:var(--ink-2)}
.kp-gc-comments:empty{display:none}
.kp-gc-comment{margin-top:8px;padding:7px 9px;border-left:3px solid var(--primary);border-radius:var(--r-sm);background:var(--primary-soft)}
/* 终端和 toast 色彩由双皮 token 集中管理。 */
.kp-term-tab{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--term-tab-border);border-bottom:none;border-radius:8px 8px 0 0;background:var(--term-tab-bg);color:var(--term-tab-fg);font:12px/18px var(--sans);cursor:pointer}
.kp-term-tab.active{background:var(--term-tab-active-bg);color:var(--term-tab-fg)}
.kp-toast{background:var(--toast-bg);color:var(--toast-fg)}
/* 统一药丸基线（batch28）*/
.tag,.status,.stage,.lvl,.ck-chip,.gate-pill,.sig,.diag,.merged{font-size:var(--fs-xs);border-radius:6px;padding:2px 8px;line-height:1.5}
/* 运营总览条（batch29）*/
.ops-overview{margin:0 0 12px}
/* 对话过程投影：全部状态只复用主题 token，保持浅色/深色皮肤一致。 */
.kp-projection-switch{display:inline-flex;align-items:center;padding:2px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg);font-family:var(--sans)}
.kp-projection-switch button{border:0;border-radius:calc(var(--r-sm) - 2px);padding:3px 7px;background:transparent;color:var(--muted);font:600 11px/1.4 var(--sans);cursor:pointer}
.kp-projection-switch button:hover{color:var(--ink);background:var(--hover)}
.kp-projection-switch button.active{color:var(--primary);background:var(--primary-soft);box-shadow:inset 0 0 0 1px var(--primary-line)}
.kp-process-group{margin:5px 0;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--card);color:var(--ink-2);font-family:var(--sans);white-space:normal}
.kp-process-group>summary{padding:6px 9px;cursor:pointer;color:var(--muted-2);font-size:12px;font-weight:650;list-style:none}
.kp-process-group>summary::before{content:"▸";display:inline-block;margin-right:6px;color:var(--primary)}
.kp-process-group[open]>summary::before{content:"▾"}
.kp-process-items{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:2px 9px 8px;border-top:1px solid var(--line-2);white-space:pre-wrap;font-family:var(--mono)}
.kp-projection-hidden{display:none!important}
.kp-loop-card{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 10px;border:1px solid var(--success-line);border-radius:var(--r-sm);background:var(--success-soft);font-family:var(--sans)}
.kp-loop-card::before{content:"✓"}
.kp-loop-copy{color:var(--ink-2);font-weight:650}
.kp-loop-fp{padding:2px 6px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--card);color:var(--muted);font-family:var(--mono);font-size:11px}
.kp-loop-backlog{margin-left:auto;padding:4px 8px;border:1px solid var(--primary-line);border-radius:var(--r-sm);background:var(--card);color:var(--primary);font:650 11px/1.4 var(--sans);cursor:pointer}
.kp-loop-backlog:hover{background:var(--primary-soft)}
`;
