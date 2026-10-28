import { escHtml } from "../../../util/esc-html.js";
import type { DashboardState } from "../../state.js";
import { buildArchitectureGraph } from "./architecture-graph.js";

export function renderArchitecture(state: DashboardState): string {
  const graphJson = escHtml(JSON.stringify(buildArchitectureGraph(state)));
  return `
    <div class="body">
      <div class="wrap">
        <div class="section-h"><h3>系统架构 · 活体拓扑</h3><span class="hint">从实时状态自动布局(ELK)· 节点挂真实指标 · 点击下钻聚焦</span></div>
        <div class="card">
          <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px;font-size:12.5px">
            <span style="color:var(--muted)">簇:</span>
            <span class="row" style="gap:5px"><i style="width:10px;height:10px;border-radius:3px;background:var(--arch-node-1);display:inline-block"></i>核心 loop</span>
            <span class="row" style="gap:5px"><i style="width:10px;height:10px;border-radius:3px;background:var(--arch-node-2);display:inline-block"></i>harness 脊柱</span>
            <span class="row" style="gap:5px"><i style="width:10px;height:10px;border-radius:3px;background:var(--arch-node-3);display:inline-block"></i>观测</span>
            <span class="row" style="gap:5px"><i style="width:10px;height:10px;border-radius:3px;background:var(--arch-node-4);display:inline-block"></i>安全闭环</span>
            <span class="row" style="gap:5px"><i style="width:10px;height:10px;border-radius:3px;background:var(--arch-node-5);display:inline-block"></i>飞轮</span>
            <span class="row" style="gap:5px"><i style="width:10px;height:10px;border-radius:3px;background:var(--arch-node-6);display:inline-block"></i>自进化</span>
            <span class="row" style="gap:5px"><i style="width:10px;height:10px;border-radius:3px;background:var(--arch-node-7);display:inline-block"></i>跨实例</span>
          </div>
          <div class="row" style="gap:14px;flex-wrap:wrap;margin-bottom:12px;color:var(--muted);font-size:12.5px">
            <span style="color:var(--muted)">状态:</span>
            <span class="row" style="gap:6px"><i style="width:10px;height:10px;border-radius:999px;background:var(--arch-node-1);display:inline-block"></i>在跑(脉冲)</span>
            <span class="row" style="gap:6px"><i style="width:10px;height:10px;border-radius:999px;background:var(--arch-node-5);display:inline-block"></i>完成</span>
            <span class="row" style="gap:6px"><i style="width:10px;height:10px;border-radius:999px;background:var(--arch-node-4);display:inline-block"></i>等门</span>
            <span class="row" style="gap:6px"><i style="width:10px;height:10px;border-radius:999px;background:var(--arch-node-7);display:inline-block"></i>失败</span>
            <span style="color:var(--muted)">· 边在相邻节点在跑时流动</span>
          </div>
          <div id="cy-arch" data-arch="${graphJson}" style="width:100%;height:clamp(320px, 68vh, 620px)"></div>
        </div>
      </div>
    </div>
  `;
}
