import { Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { Server as WebSocketServer } from "ws";

let wss: WebSocketServer | null = null;
const clients = new Map<string, any>();

export function setWebSocketServer(server: WebSocketServer) {
  wss = server;
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", "http://localhost");
    const userId = url.searchParams.get("userId");
    if (userId) {
      clients.set(userId, ws);
      ws.send(JSON.stringify({ type: "connected", userId }));
    }
    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "chat" && msg.to && msg.text) {
          const created = await prisma.message.create({
            data: { fromUserId: userId || "", toUserId: msg.to, text: msg.text },
          });
          const target = clients.get(msg.to);
          if (target && target.readyState === 1) {
            target.send(JSON.stringify({ type: "chat", from: userId, text: msg.text, time: new Date().toISOString(), messageId: created.id }));
          }
          // Send delivery confirmation back to sender
          ws.send(JSON.stringify({ type: "sent", messageId: created.id }));
        }
        if (msg.type === "read" && msg.fromUserId && userId) {
          // Mark all messages from the other user as read
          await prisma.message.updateMany({
            where: { fromUserId: msg.fromUserId, toUserId: userId, read: false },
            data: { read: true, readAt: new Date() },
          });
          // Notify the original sender that their messages were read
          const sender = clients.get(msg.fromUserId);
          if (sender && sender.readyState === 1) {
            sender.send(JSON.stringify({ type: "read_receipt", readBy: userId }));
          }
        }
      } catch {}
    });
    ws.on("close", () => { if (userId) clients.delete(userId); });
  });
}

export const getMessages = catchAsync(async (req: AuthRequest, res: Response) => {
  const otherId = req.params.userId;
  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { fromUserId: req.userId!, toUserId: otherId },
        { fromUserId: otherId, toUserId: req.userId! },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, fromUserId: true, toUserId: true, text: true, read: true, readAt: true, createdAt: true },
  });
  res.json(messages);
});

export const markMessagesRead = catchAsync(async (req: AuthRequest, res: Response) => {
  const otherId = req.params.userId;
  await prisma.message.updateMany({
    where: { fromUserId: otherId, toUserId: req.userId!, read: false },
    data: { read: true, readAt: new Date() },
  });
  // Notify via WebSocket
  const sender = clients.get(otherId);
  if (sender && sender.readyState === 1) {
    sender.send(JSON.stringify({ type: "read_receipt", readBy: req.userId }));
  }
  res.json({ success: true });
});

export const sendMessage = catchAsync(async (req: AuthRequest, res: Response) => {
  const { text } = z.object({ text: z.string().min(1) }).parse(req.body);
  const msg = await prisma.message.create({
    data: { fromUserId: req.userId!, toUserId: req.params.userId, text },
    select: { id: true, fromUserId: true, toUserId: true, text: true, read: true, readAt: true, createdAt: true },
  });
  const target = clients.get(req.params.userId);
  if (target && target.readyState === 1) {
    target.send(JSON.stringify({ type: "chat", from: req.userId, text, time: new Date().toISOString(), messageId: msg.id }));
  }
  res.status(201).json(msg);
});

export const submitReview = catchAsync(async (req: AuthRequest, res: Response) => {
  const { rating, comment } = z.object({ rating: z.number().min(1).max(5), comment: z.string().optional() }).parse(req.body);
  const priestId = req.params.id;
  const priest = await prisma.priest.findUnique({ where: { id: priestId } });
  if (!priest) throw new AppError("Priest not found", 404);

  const completed = await prisma.booking.findFirst({
    where: { userId: req.userId!, priestId, status: "completed" },
  });
  if (!completed) throw new AppError("You can only review after a completed puja", 400);

  const existing = await prisma.priestReview.findFirst({
    where: { userId: req.userId!, priestId },
  });
  if (existing) throw new AppError("You have already reviewed this priest", 400);

  await prisma.priestReview.create({
    data: { priestId, userId: req.userId!, rating, comment },
  });

  const avg = await prisma.priestReview.aggregate({
    where: { priestId },
    _avg: { rating: true },
    _count: { rating: true },
  });
  await prisma.priest.update({
    where: { id: priestId },
    data: { rating: avg._avg.rating || rating, reviewCount: avg._count.rating || 0 },
  });

  res.status(201).json({ message: "Review submitted", newRating: avg._avg.rating });
});

export const getChatUsers = catchAsync(async (req: AuthRequest, res: Response) => {
  const bookings = await prisma.booking.findMany({
    where: {
      OR: [{ userId: req.userId! }, { priest: { userId: req.userId! } }],
    },
    include: { user: { select: { id: true, name: true } }, priest: { select: { userId: true, name: true } } },
    distinct: ["userId", "priestId"],
  });
  const users = bookings.map(b => ({
    id: b.userId === req.userId ? b.priest.userId : b.userId,
    name: b.userId === req.userId ? b.priest.name : b.user.name,
  }));
  const unique = [...new Map(users.filter(u => u.id).map(u => [u.id, u])).values()];
  res.json(unique);
});
