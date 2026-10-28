export function isAllowedWsOrigin(input: {
  origin?: string;
  host?: string;
  extraAllowed?: readonly string[];
}): { ok: boolean; reason: "no-origin" | "same-host" | "configured" | "cross-origin" } {
  const { origin, host, extraAllowed } = input;
  if (origin === undefined || origin === "" || origin === "null") {
    return { ok: true, reason: "no-origin" };
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return { ok: false, reason: "cross-origin" };
  }

  if (originHost === host) {
    return { ok: true, reason: "same-host" };
  }
  if (extraAllowed?.includes(origin)) {
    return { ok: true, reason: "configured" };
  }
  return { ok: false, reason: "cross-origin" };
}
