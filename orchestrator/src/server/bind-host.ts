/** 解析 cockpit 绑定地址。优先级:--host 参数 > KUNPENG_HOST env > 默认 127.0.0.1(只本机,安全)。
 *  "0.0.0.0" / "lan" / "all" 归一成 "0.0.0.0"(监听所有网卡,局域网/隧道可达)。纯函数。 */
export function resolveBindHost(flagHost: string | undefined, envHost: string | undefined): string {
  const raw = (flagHost ?? envHost ?? "").trim().toLowerCase();
  if (raw === "") return "127.0.0.1";
  if (raw === "0.0.0.0" || raw === "lan" || raw === "all") return "0.0.0.0";
  return raw; // 允许显式指定某网卡 IP
}

/** 给用户看的访问提示:绑 0.0.0.0 时提示用局域网 IP 访问,否则 localhost。 */
export function accessHint(host: string, port: number, lanIp?: string): string {
  if (host === "0.0.0.0") {
    return `http://localhost:${port}（本机）｜ http://${lanIp ?? "<本机局域网IP>"}:${port}（同 WiFi 设备）`;
  }
  return `http://localhost:${port}（仅本机；要别的设备连加 --host 0.0.0.0）`;
}

/** 非回环绑定且未设密码时给出拒绝理由;KUNPENG_ALLOW_INSECURE=1 显式放行。回环(127.0.0.1/localhost/::1)永不拦。 */
export function insecureServeReason(bindHost: string, hasAuth: boolean, env: Record<string, string | undefined>): string | undefined {
  const loopback = bindHost === "127.0.0.1" || bindHost === "localhost" || bindHost === "::1";
  if (loopback || hasAuth || env.KUNPENG_ALLOW_INSECURE === "1") return undefined;
  return `绑定 ${bindHost} 但未设置访问密码——局域网任何人可直进总控台。请先 kunpeng auth set-password 设密码,或显式 KUNPENG_ALLOW_INSECURE=1 放行(不建议)。`;
}
