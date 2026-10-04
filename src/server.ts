import http from "http";
import { WebSocketServer } from "ws";
import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { setWebSocketServer } from "./controllers/chat.controller";

const HOST = "0.0.0.0";
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });
setWebSocketServer(wss);

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED_REJECTION]", reason);
});

server.listen(env.port, HOST, () => {
  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("  🛕  Temple Connect API v2.1");
  console.log("  HTTP:  http://localhost:" + env.port);
  console.log("  WS:    ws://localhost:" + env.port + "/ws?token=<JWT>");
  console.log("  Env:   " + env.nodeEnv);
  console.log("═══════════════════════════════════════════");
  console.log("");
});

async function shutdown() {
  wss.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
