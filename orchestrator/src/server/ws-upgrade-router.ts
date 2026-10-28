import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

export interface UpgradeRoute {
  name: string;
  matches: (path: string) => boolean;
  handle: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

interface RegisteredRoute {
  route: UpgradeRoute;
}

interface UpgradeRouterState {
  routes: RegisteredRoute[];
}

const routers = new WeakMap<Server, UpgradeRouterState>();

export function rejectUpgrade(
  socket: Duplex,
  status: string,
  opts?: { headers?: Record<string, string>; message?: string },
): void {
  try {
    if (socket.destroyed) return;
    const message = opts?.message ?? status.match(/^\d{3}\s+(.+)$/)?.[1] ?? status;
    const body = JSON.stringify({ error: message });
    const headerLines = Object.entries(opts?.headers ?? {}).map(([name, value]) => `${name}: ${value}`);
    socket.end([
      `HTTP/1.1 ${status}`,
      ...headerLines,
      "Content-Type: application/json; charset=utf-8",
      `Content-Length: ${Buffer.byteLength(body, "utf8")}`,
      "Connection: close",
      "",
      body,
    ].join("\r\n"));
  } catch {
    try {
      socket.destroy();
    } catch {
      // The rejection path must never surface socket failures.
    }
  }
}

function handleUpgrade(
  state: UpgradeRouterState,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const path = (req.url ?? "").split("?")[0];
  for (const registered of state.routes) {
    let matched = false;
    try {
      matched = registered.route.matches(path);
    } catch (error) {
      console.error(`[ws-upgrade-router] route ${registered.route.name} match failed:`, error);
    }
    if (!matched) continue;

    try {
      registered.route.handle(req, socket, head);
    } catch (error) {
      console.error(`[ws-upgrade-router] route ${registered.route.name} handle failed:`, error);
      socket.destroy();
    }
    return;
  }

  rejectUpgrade(socket, "404 Not Found");
}

export function registerUpgradeRoute(server: Server, route: UpgradeRoute): () => void {
  let state = routers.get(server);
  if (!state) {
    state = { routes: [] };
    routers.set(server, state);
    const serverState = state;
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      handleUpgrade(serverState, req, socket, head);
    });
  }

  const registered = { route };
  state.routes.push(registered);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const index = state.routes.indexOf(registered);
    if (index !== -1) state.routes.splice(index, 1);
  };
}

export function upgradeRouteNames(server: Server): string[] {
  return routers.get(server)?.routes.map(({ route }) => route.name) ?? [];
}
