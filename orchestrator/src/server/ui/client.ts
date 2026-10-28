import { CHAT_COMMANDS } from "../chat-commands.js";
import { DEFAULT_PRICE_PER_MTOK, MODEL_PRICING_PER_MTOK } from "../../runtime/cost-pricing.js";
import { part01 } from "./client-parts/part01.js";
import { part02 } from "./client-parts/part02.js";
import { part03 } from "./client-parts/part03.js";
import { part04 } from "./client-parts/part04.js";
import { part05 } from "./client-parts/part05.js";
import { part06 } from "./client-parts/part06.js";
import { part07 } from "./client-parts/part07.js";
import { part08 } from "./client-parts/part08.js";
import { part09 } from "./client-parts/part09.js";
import { part10 } from "./client-parts/part10.js";

const serializedChatCommands = JSON.stringify(CHAT_COMMANDS);
const serializedPricing = JSON.stringify({ table: MODEL_PRICING_PER_MTOK, def: DEFAULT_PRICE_PER_MTOK });

export const clientScript: string = `
(function () {
  "use strict";

  var CHAT_COMMANDS = ${serializedChatCommands};
  var KP_PRICING = ${serializedPricing};

  var latestState = null;
  var kpVendorPromises = {};
  var kpOcrWorkerPromise = null;
  var kpOcrQueue = Promise.resolve();
  var kpPdfjsPromise = null;
  var kpMermaidReadyPromise = null;
  var kpKatexReadyPromise = null;
  var kpMermaidSequence = 0;
  var paletteEl = null;
  var KW_SIZES = {1:13,2:16,3:20,4:25,5:31};
  var SB_AS = "cockpit";
  var sbPollTimer = null;
  var sbStream = null;
  var wbStreams = [];
  var termTabs = [];          // [{ key, id, term, fit, ws, wrapEl, reconnectTimer, closing, exited }]
  var termActiveKey = null;
  var termKeySeq = 1;
  var termResizeHandler = null;
  var termOfflineHandler = null;
  var termOnlineHandler = null;
  var flowsPollTimer = null;
  var archPollTimer = null;
  var taskBoardPollTimer = null;
  var archLayoutMode = "layer";
  var archLayerLabels = ["入口层", "编排层", "引擎层", "数据·记忆层", "外部执行层"];
  var legacyReviewInboxRoute = "#/" + ["review", "inbox"].join("-");
  var kpInboxSelectedId = "";
  var kpInboxSelectedIndex = -1;
  var kpInboxConfirm = null;
  var kpInboxHelpEl = null;

${part01}${part02}${part03}${part04}${part05}${part06}${part08}${part09}${part10}${part07}`;
