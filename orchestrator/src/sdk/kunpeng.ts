import { EventEmitter } from "node:events";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveKunpengHome } from "../util/kunpeng-home.js";
import { ArtifactStore } from "../artifacts/store.js";
import type { AgentRunner } from "../agent/runner.js";
import { writeBoard, type BoardWriteResult } from "../board/write-board.js";
import { runGuardian, type Finding, type Scanner, DEFAULT_SCANNERS } from "../loop/guardian.js";
import { DevCycle, type DevCycleResult } from "../loop/dev-cycle.js";
import { auditAcceptanceTest } from "../loop/audit.js";
import { parseMethodPlan } from "../plan/parse.js";
import { translationPrompt } from "../plan/acceptance.js";
import { runPlan } from "../plan/orchestrator.js";
import type { PlanResult } from "../plan/types.js";
import { collectState, type DashboardState } from "../server/dashboard.js";
import { createContext } from "./context.js";
import type { KunpengEvent, OnEvent } from "./events.js";
import { fileSwitchboardSender } from "../switchboard/default-sender.js";

export interface KunpengOptions {
  repo: string;
  home?: string;
  runner?: AgentRunner;
  checks?: string[];
  concurrency?: number;
  now?: () => number;
}

export interface KunpengPlanOptions {
  concurrency?: number;
}

export interface KunpengRunOptions {
  acceptanceCmd?: string;
}

export interface GuardResult {
  findings: Finding[];
}

type KunpengEventMap = {
  phase: Extract<KunpengEvent, { type: "phase" }>;
  flow: Extract<KunpengEvent, { type: "flow" }>;
  gate: Extract<KunpengEvent, { type: "gate" }>;
  done: Extract<KunpengEvent, { type: "done" }>;
};
type EventEmitterListener = Parameters<EventEmitter["on"]>[1];

async function readMarkdownOrLiteral(input: string): Promise<string> {
  const candidate = resolve(input);
  try {
    await access(candidate);
    return await readFile(candidate, "utf8");
  } catch {
    return input;
  }
}

export class Kunpeng extends EventEmitter {
  private readonly repoRoot: string;
  private readonly kunpengHome: string;

  constructor(private readonly opts: KunpengOptions) {
    super();
    this.repoRoot = resolve(opts.repo);
    this.kunpengHome = opts.home ? resolve(opts.home) : resolveKunpengHome();
  }

  async plan(planMdOrPath: string, opts: KunpengPlanOptions = {}): Promise<PlanResult> {
    const md = await readMarkdownOrLiteral(planMdOrPath);
    const model = parseMethodPlan(md);
    const ctx = await createContext(this.repoRoot, this.kunpengHome);
    const runner = this.opts.runner ?? ctx.runner;
    const checks = this.opts.checks ?? ctx.checks;

    for (const phase of model.phases) {
      for (const flow of phase.flows) {
        if (flow.acceptanceCmd) continue;
        const translated = await runner.run({
          stage: "spec",
          system: ctx.projectRules,
          input: translationPrompt(flow.requirement),
          tools: [],
        });
        const cmd = String(translated.text).trim();
        const audit = auditAcceptanceTest(cmd, { cwd: this.repoRoot });
        if (!audit.strong) {
          throw new Error(`plan flow ${flow.id} 验收翻译过弱(${audit.reason})`);
        }
        flow.acceptanceCmd = cmd;
      }
    }

    const result = await runPlan(model, {
      repoRoot: this.repoRoot,
      store: ctx.store,
      ws: ctx.ws,
      tracker: ctx.tracker,
      runner,
      checks,
      projectRules: ctx.projectRules,
      concurrency: opts.concurrency ?? this.opts.concurrency,
      now: this.opts.now,
      onEvent: (event) => this.emitKunpengEvent(event),
    });
    await writeBoard(this.repoRoot).catch(() => {});
    return result;
  }

  async run(requirement: string, opts: KunpengRunOptions = {}): Promise<DevCycleResult> {
    const ctx = await createContext(this.repoRoot, this.kunpengHome);
    const flowId = requirement.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "flow";
    const dc = new DevCycle({
      store: ctx.store,
      ws: ctx.ws,
      runner: this.opts.runner ?? ctx.runner,
      flowId: `${flowId}-${(this.opts.now ?? Date.now)().toString(36)}`,
      tracker: ctx.tracker,
      checks: this.opts.checks ?? ctx.checks,
      projectRules: ctx.projectRules,
      acceptanceCmd: opts.acceptanceCmd,
      onEvent: (event) => this.emitKunpengEvent(event),
      switchboard: fileSwitchboardSender(),
    });
    const result = await dc.run(requirement);
    await writeBoard(this.repoRoot).catch(() => {});
    return result;
  }

  async board(): Promise<BoardWriteResult | null> {
    return writeBoard(this.repoRoot);
  }

  async guard(scanners: Scanner[] = DEFAULT_SCANNERS): Promise<GuardResult> {
    return { findings: await runGuardian(this.repoRoot, scanners) };
  }

  async state(): Promise<DashboardState> {
    return collectState(new ArtifactStore(join(this.repoRoot, ".kunpeng", "artifacts")), this.repoRoot, { kunpengHome: this.kunpengHome });
  }

  private emitKunpengEvent(event: KunpengEvent): void {
    this.emit(event.type, event);
  }

  on<T extends keyof KunpengEventMap>(eventName: T, listener: (event: KunpengEventMap[T]) => void): this;
  on(eventName: string | symbol, listener: (...args: never[]) => void): this;
  on(eventName: string | symbol, listener: (...args: never[]) => void): this {
    return super.on(eventName, listener as EventEmitterListener);
  }

  onEvent(listener: OnEvent): this {
    this.on("phase", listener as (event: KunpengEventMap["phase"]) => void);
    this.on("flow", listener as (event: KunpengEventMap["flow"]) => void);
    this.on("gate", listener as (event: KunpengEventMap["gate"]) => void);
    this.on("done", listener as (event: KunpengEventMap["done"]) => void);
    return this;
  }
}
