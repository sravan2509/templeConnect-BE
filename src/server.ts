import http from "http";
import { WebSocketServer } from "ws";
import { app } from "./app";
import { env } from "./config/env";
import { setWebSocketServer } from "./controllers/chat.controller";

const HOST = "0.0.0.0";
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/ws" });
setWebSocketServer(wss);

server.listen(env.port, HOST, () => {
  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("  🛕  Temple Connect API v2.0");
  console.log("  HTTP:  http://localhost:" + env.port);
  console.log("  WS:    ws://localhost:" + env.port + "/ws");
  console.log("  Env:   " + env.nodeEnv);
  console.log("═══════════════════════════════════════════");
  console.log("");
  console.log("  Endpoints:");
  console.log("    POST /api/auth/register    Register");
  console.log("    POST /api/auth/login       Login");
  console.log("    GET  /api/admin/pujas      List pujas");
  console.log("    POST /api/bookings         Book puja");
  console.log("    GET  /api/chat/:userId     Chat messages");
  console.log("    POST /api/priests/:id/reviews  Submit review");
  console.log("    WS   /ws?userId=xxx        Live chat");
  console.log("");
});
