import { escHtml } from "../../../util/esc-html.js";
import type { DashboardState } from "../../state.js";

export function renderRegisterProject(_state: DashboardState): string {
  return `
    <div class="section-h">
      <h3>${escHtml("接管新项目")}</h3>
      <span class="hint">${escHtml("注册已有仓库")}</span>
    </div>
    <div class="runs">
      <div class="run">
        <span class="tag">${escHtml("仓库路径")}</span>
        <input class="ipt" data-field="repoPath" placeholder="/绝对/路径/到仓库">
      </div>
      <div class="run">
        <span class="tag">${escHtml("项目名")}</span>
        <input class="ipt" data-field="name" placeholder="项目名（可选）">
      </div>
      <div class="run">
        <button class="b pri" data-action="register-project">接管</button>
        <span class="muted">${escHtml("接管后会写入中央注册表，并在 repo 内写入 .kunpeng/project.json 自描。")}</span>
      </div>
    </div>
  `;
}
