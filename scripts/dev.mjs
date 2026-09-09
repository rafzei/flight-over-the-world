import { createServer } from "vite";
import { startTrafficServer } from "../server/trafficServer.mjs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { port: { type: "string", default: "5173" }, "traffic-port": { type: "string" } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid development port");
if (values["traffic-port"]) process.env.TRAFFIC_PORT = values["traffic-port"];

let traffic, vite;
const stop = async () => {
  await vite?.close();
  if (traffic) { traffic.server.close(); traffic.server.closeIdleConnections(); }
};
try {
  traffic = await startTrafficServer({ allowedOrigins: [`http://localhost:${port}`, `http://127.0.0.1:${port}`, "http://localhost:4173", "http://127.0.0.1:4173"] });
  vite = await createServer({ server: { port } });
  await vite.listen();
  vite.printUrls();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch (error) {
  console.error(error.code === "EADDRINUSE" ? "A development port is already in use." : "Could not start development servers; check configuration and ports.");
  await stop();
  process.exitCode = 1;
}
