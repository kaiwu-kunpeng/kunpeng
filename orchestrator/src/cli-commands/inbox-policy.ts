import { join } from "node:path";
import { kunpengStateDir } from "../project/state-dir.js";
import { loadInboxPolicy, saveInboxPolicy } from "../server/inbox-policy.js";
import { registerCliCommand, type CliContext } from "./registry.js";

function usage(): void {
  console.error("用法: kunpeng inbox-policy show | absence <hours> [--note <文字>] | present | cap <n> | ttl <hours>");
  process.exitCode = 1;
}

async function run(context: CliContext): Promise<void> {
  const path = join(kunpengStateDir(), "inbox-policy.json");
  const policy = loadInboxPolicy(path);
  const sub = context.rest[0];
  if (sub === "show") {
    console.log(JSON.stringify(policy, null, 2));
    return;
  }
  if (sub === "present") {
    delete policy.absence;
  } else if (sub === "absence" || sub === "cap" || sub === "ttl") {
    const value = Number(context.rest[1]);
    if (!Number.isFinite(value) || value <= 0 || (sub === "cap" && !Number.isInteger(value))) {
      usage();
      return;
    }
    if (sub === "absence") {
      const noteIndex = context.rest.indexOf("--note", 2);
      const note = noteIndex >= 0 ? context.rest[noteIndex + 1] : undefined;
      if (noteIndex >= 0 && note === undefined) {
        usage();
        return;
      }
      policy.absence = {
        until: Date.now() + value * 3_600_000,
        ...(note !== undefined ? { note } : {}),
      };
    } else if (sub === "cap") {
      policy.dailyHardCapPerProject = value;
    } else {
      policy.gateTtlHours = value;
    }
  } else {
    usage();
    return;
  }
  await saveInboxPolicy(path, policy);
  console.log(JSON.stringify(policy, null, 2));
}

registerCliCommand({ name: "inbox-policy", run });
