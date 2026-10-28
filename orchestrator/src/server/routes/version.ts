import { versionInfo } from "../../runtime/version.js";
import { registerModularRoute } from "./registry.js";

registerModularRoute({
  method: "GET",
  path: "/api/version",
  handle: (_req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(versionInfo()));
  },
});
