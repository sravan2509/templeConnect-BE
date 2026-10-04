import { Response } from "express";
import { z } from "zod";
import { WebSocket, WebSocketServer } from "ws";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest, authenticateToken } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";

const MESSAGE_PAGE = 100;
const MAX_MESSAGE_LENGTH = 2000;

// A user may have several sockets open (e.g. two devices).
const clients = new Map<string, Set<WebSocket>>();

function sendTo(userId: string, payload: unknown) {
  const sockets = clients.get(userId);
  if (!sockets) return;
  const data = JSON.stringify(payload);
  for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

/** Two users may chat only if they share a booking (devotee ↔ priest), or one is an admin. */
async function assertCanChat(userId: string, otherId: string, role?: string) {
  if (userId === otherId) throw new AppError("You cannot message yourself", 400);
  const other = await prisma.user.findUnique({ where: { id: otherId }, select: { id: true, role: true } });
  if (!other) throw new AppError("User not found", 404);
  if (role === "admin" || other.role === "admin") return;
  const shared = await prisma.booking.findFirst({
    where: {
      status: { in: ["pending", "confirmed", "completed"] },
      OR: [
        { userId, priest: { userId: otherId } },
        { userId: otherId, priest: { userId } },
      ],
    },
    select: { id: true },
  });
  if (!shared) throw new AppError("You can only message priests or devotees you have a booking with", 403);
}

async function createMessage(fromUserId: string, toUserId: string, text: string) {
  const msg = await prisma.message.create({
    data: { fromUserId, toUserId, text },
    select: { id: true, fromUserId: true, toUserId: true, text: true, read: true, readAt: true, createdAt: true },
  });
  sendTo(toUserId, { type: "chat", message: msg });
  return msg;
}

async function markRead(readerId: string, otherId: string) {
  const result = await prisma.message.updateMany({
    where: { fromUserId: otherId, toUserId: readerId, read: false },
    data: { read: true, readAt: new Date() },
  });
  if (result.count > 0) sendTo(otherId, { type: "read_receipt", readBy: readerId });
}

/**
 * WebSocket endpoint: ws://host/ws?token=<JWT>. The user is taken from the token,
 * never from a client-supplied id.
 */
export function setWebSocketServer(wss: WebSocketServer) {
  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url || "", "http://localhost");
    const auth = await authenticateToken(url.searchParams.get("token") || "");
    if (!auth) {
      ws.close(4401, "Unauthorized");
      return;
    }
    const { userId, role } = auth;
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId)!.add(ws);
    ws.send(JSON.stringify({ type: "connected", userId }));

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "chat" && typeof msg.to === "string" && typeof msg.text === "string") {
          const text = msg.text.trim().slice(0, MAX_MESSAGE_LENGTH);
          if (!text) return;
          await assertCanChat(userId, msg.to, role);
          const created = await createMessage(userId, msg.to, text);
          ws.send(JSON.stringify({ type: "sent", message: created }));
        } else if (msg.type === "read" && typeof msg.fromUserId === "string") {
          await markRead(userId, msg.fromUserId);
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ type: "error", error: err instanceof AppError ? err.message : "Message could not be processed" }));
      }
    });

    ws.on("close", () => {
      const set = clients.get(userId);
      set?.delete(ws);
      if (set && set.size === 0) clients.delete(userId);
    });
  });
}

export const getMessages = catchAsync(async (req: AuthRequest, res: Response) => {
  const otherId = req.params.userId;
  await assertCanChat(req.userId!, otherId, req.userRole);
  // Fetch the newest page, then return it oldest-first for display.
  const latest = await prisma.message.findMany({
    where: {
      OR: [
        { fromUserId: req.userId!, toUserId: otherId },
        { fromUserId: otherId, toUserId: req.userId! },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: MESSAGE_PAGE,
    select: { id: true, fromUserId: true, toUserId: true, text: true, read: true, readAt: true, createdAt: true },
  });
  res.json(latest.reverse());
});

export const markMessagesRead = catchAsync(async (req: AuthRequest, res: Response) => {
  await markRead(req.userId!, req.params.userId);
  res.json({ success: true });
});

export const sendMessage = catchAsync(async (req: AuthRequest, res: Response) => {
  const { text } = z.object({ text: z.string().trim().min(1, "Message cannot be empty").max(MAX_MESSAGE_LENGTH) }).parse(req.body);
  await assertCanChat(req.userId!, req.params.userId, req.userRole);
  res.status(201).json(await createMessage(req.userId!, req.params.userId, text));
});

export const getChatUsers = catchAsync(async (req: AuthRequest, res: Response) => {
  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: ["pending", "confirmed", "completed"] },
      OR: [{ userId: req.userId! }, { priest: { userId: req.userId! } }],
    },
    include: { user: { select: { id: true, name: true } }, priest: { select: { userId: true, name: true } } },
  });
  const byId = new Map<string, { id: string; name: string }>();
  for (const b of bookings) {
    const other = b.userId === req.userId ? { id: b.priest.userId, name: b.priest.name } : { id: b.userId, name: b.user.name };
    if (other.id && !byId.has(other.id)) byId.set(other.id, other as { id: string; name: string });
  }

  const ids = [...byId.keys()];
  const [unread, last] = await Promise.all([
    prisma.message.groupBy({
      by: ["fromUserId"],
      where: { toUserId: req.userId!, read: false, fromUserId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.message.groupBy({
      by: ["fromUserId", "toUserId"],
      where: {
        OR: [
          { fromUserId: req.userId!, toUserId: { in: ids } },
          { toUserId: req.userId!, fromUserId: { in: ids } },
        ],
      },
      _max: { createdAt: true },
    }),
  ]);
  const unreadMap = new Map(unread.map((u) => [u.fromUserId, u._count._all]));
  const lastMap = new Map<string, number>();
  for (const l of last) {
    const other = l.fromUserId === req.userId ? l.toUserId : l.fromUserId;
    const t = l._max.createdAt?.getTime() ?? 0;
    if (t > (lastMap.get(other) ?? 0)) lastMap.set(other, t);
  }

  const users = ids
    .map((id) => ({
      ...byId.get(id)!,
      unreadCount: unreadMap.get(id) ?? 0,
      lastMessageAt: lastMap.has(id) ? new Date(lastMap.get(id)!).toISOString() : null,
    }))
    .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
  res.json(users);
});
