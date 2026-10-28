export interface SessionSignals {
  durationMin: number;
  userMsgs: number;
  userChars: number;
}

export type AutomationLevel = "L1" | "L2" | "L3";

export function classify(s: SessionSignals): AutomationLevel {
  if (s.userMsgs <= 2 && s.userChars <= 400) return "L3";
  if (s.userMsgs >= 8 || s.userChars >= 2000) return "L1";
  return "L2";
}
