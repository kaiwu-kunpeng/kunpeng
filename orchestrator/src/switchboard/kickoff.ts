export const KICKOFF_KIND = "kickoff";

const KICKOFF_RE = /开工|预告|占用|即将|要碰|要动|要改|正在(做|改|占|建|写)|开始(做|建|改)|kickoff|claim|working on/i;

export function isKickoffMessage(msg: { kind?: string; body?: string }): boolean {
  if (msg.kind === KICKOFF_KIND) return true;
  return KICKOFF_RE.test(msg.body ?? "");
}

export function formatKickoffBody(input: { instance: string; files: string[]; what: string }): string {
  const files = input.files.length > 0 ? input.files.join(", ") : "(未指定)";
  return `【${input.instance}·开工预告】${input.what} 文件: ${files}`;
}
