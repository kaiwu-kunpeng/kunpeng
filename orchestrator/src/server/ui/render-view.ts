import type { DashboardState } from "../state.js";
import { renderOverview } from "./views/overview.js";
import { renderReviewInbox } from "./views/review-inbox.js";
import { renderProject } from "./views/project.js";
import { renderEvolution } from "./views/evolution.js";
import { renderLoops } from "./views/loops.js";
import { renderKnowledge } from "./views/knowledge.js";
import { renderSwitchboard } from "./views/switchboard.js";
import { renderWorkbench } from "./views/workbench.js";
import { renderArchitecture } from "./views/architecture.js";
import { renderTerminal } from "./views/terminal.js";
import { renderSettings } from "./views/settings.js";
import { renderRegisterProject } from "./views/register-project.js";
import { renderTasks } from "./views/tasks.js";
import { renderSolutions } from "./views/solutions.js";
import { renderSkills } from "./views/skills.js";
import { renderDocs } from "./views/docs.js";
import { renderLibrary } from "./views/library.js";
import { renderInsights } from "./views/insights.js";

const legacyReviewInboxRoute = "#/" + ["review", "inbox"].join("-");

function parseProjectRoute(route: string): { id: string; tab: string } | undefined {
  if (!route.startsWith("#/project/")) return undefined;

  const parts = route.slice("#/project/".length).split("/");
  if (parts.length < 1 || parts.length > 2 || !parts[0]) return undefined;

  try {
    const id = decodeURIComponent(parts[0]);
    const tab = parts[1] ? decodeURIComponent(parts[1]) : "overview";
    if (!id) return undefined;
    return { id, tab };
  } catch {
    return undefined;
  }
}

export function renderViewFragment(
  state: DashboardState,
  route: string,
  opts?: { projectName?: string; projectId?: string },
): string {
  if (route === "#/inbox" || route === legacyReviewInboxRoute) {
    return renderReviewInbox(state);
  }

  if (route === "#/evolution") {
    return renderEvolution(state);
  }

  if (route === "#/loops") {
    return renderLoops(state);
  }

  if (route === "#/insights") {
    return renderInsights(state);
  }

  if (route === "#/tasks") {
    return renderTasks(state.flows.map((flow) => ({
      id: flow.flowId,
      requirement: flow.requirement,
      stage: flow.stage,
      status: flow.status,
      project: flow.project,
      elapsedMs: flow.elapsedMs,
      tokens: flow.tokensUsed,
      stageTokens: flow.stageTokens,
      stageModels: flow.stageModels,
      tokenQuad: flow.tokenQuad,
      model: flow.backend,
      history: flow.history,
      planId: flow.planId,
    })));
  }

  if (route === "#/knowledge") {
    return renderKnowledge(state);
  }

  if (route === "#/library") {
    return renderLibrary(state);
  }

  if (route === "#/switchboard") {
    return renderSwitchboard(state);
  }

  if (route === "#/workbench") {
    return renderWorkbench(state);
  }

  if (route === "#/architecture") {
    return renderArchitecture(state);
  }
  if (route === "#/terminal") {
    return renderTerminal(state);
  }

  if (route === "#/settings") {
    return renderSettings(state);
  }

  if (route === "#/register-project") {
    return renderRegisterProject(state);
  }

  if (route === "#/solutions") {
    return renderSolutions(state);
  }

  if (route === "#/docs") {
    return renderDocs(state);
  }

  if (route === "#/skills") {
    return renderSkills(state);
  }

  const projectRoute = parseProjectRoute(route || "");
  if (projectRoute) {
    return renderProject(state, projectRoute.id, projectRoute.tab, { projectName: opts?.projectName });
  }

  return renderOverview(state);
}
