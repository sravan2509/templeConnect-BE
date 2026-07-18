import { Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { randomUUID } from "crypto";

export const getMe = catchAsync(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw new AppError("User not found", 404);
  res.json(user);
});

const updateMeSchema = z.object({ name: z.string().min(1).optional() });

export const updateMe = catchAsync(async (req: AuthRequest, res: Response) => {
  const { name } = updateMeSchema.parse(req.body);
  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: { name },
    select: { id: true, name: true, email: true },
  });
  res.json(user);
});

// ---- Notification Preferences ----

export const getNotificationPrefs = catchAsync(async (req: AuthRequest, res: Response) => {
  let prefs = await prisma.notificationPreference.findUnique({ where: { userId: req.userId! } });
  if (!prefs) {
    prefs = await prisma.notificationPreference.create({
      data: { userId: req.userId! },
    });
  }
  res.json(prefs);
});

export const updateNotificationPrefs = catchAsync(async (req: AuthRequest, res: Response) => {
  const prefs = await prisma.notificationPreference.upsert({
    where: { userId: req.userId! },
    create: { userId: req.userId!, ...req.body },
    update: req.body,
  });
  res.json(prefs);
});

// ---- Account security ----

export const changePassword = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, message: "Password change via profile — use auth/change-password endpoint" });
});

export const get2fa = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.json({ enabled: false });
});

export const enable2fa = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.json({ enabled: true, message: "2FA enabled (mock)" });
});

export const getDevices = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.json([{ id: "device-1", name: "This device", lastActive: new Date().toISOString() }]);
});

export const deleteAccount = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.user.delete({ where: { id: req.userId! } });
  res.json({ success: true, message: "Account deleted" });
});

// ---- Subscriptions ----

export const getPlan = catchAsync(async (req: AuthRequest, res: Response) => {
  let sub = await prisma.subscription.findUnique({ where: { userId: req.userId! } });
  if (!sub) {
    sub = await prisma.subscription.create({ data: { userId: req.userId! } });
  }
  res.json(sub);
});

export const upgradePlan = catchAsync(async (req: AuthRequest, res: Response) => {
  const { plan } = z.object({ plan: z.enum(["premium_monthly", "premium_yearly"]) }).parse(req.body);
  const sub = await prisma.subscription.upsert({
    where: { userId: req.userId! },
    create: {
      userId: req.userId!,
      plan,
      renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    update: { plan, renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  });
  res.json(sub);
});

export const updatePaymentMethod = catchAsync(async (req: AuthRequest, res: Response) => {
  const { paymentMethod } = z.object({ paymentMethod: z.string().min(1) }).parse(req.body);
  const sub = await prisma.subscription.upsert({
    where: { userId: req.userId! },
    create: { userId: req.userId!, paymentMethod },
    update: { paymentMethod },
  });
  res.json(sub);
});

export const cancelSubscription = catchAsync(async (req: AuthRequest, res: Response) => {
  const sub = await prisma.subscription.upsert({
    where: { userId: req.userId! },
    create: { userId: req.userId! },
    update: { plan: "free", renewsAt: null },
  });
  res.json(sub);
});

// ---- Activity: checkins / donations ----

export const getCheckins = catchAsync(async (req: AuthRequest, res: Response) => {
  const checkins = await prisma.checkin.findMany({
    where: { userId: req.userId! },
    orderBy: { visitedAt: "desc" },
    take: 50,
  });
  res.json(checkins);
});

export const createCheckin = catchAsync(async (req: AuthRequest, res: Response) => {
  const { templeName, placeId, lat, lon } = z.object({
    templeName: z.string().min(1),
    placeId: z.string().optional(),
    lat: z.number().optional(),
    lon: z.number().optional(),
  }).parse(req.body);
  const checkin = await prisma.checkin.create({
    data: { userId: req.userId!, templeName, placeId, lat, lon },
  });
  res.status(201).json(checkin);
});

export const getDonations = catchAsync(async (req: AuthRequest, res: Response) => {
  const donations = await prisma.donation.findMany({
    where: { userId: req.userId! },
    orderBy: { donatedAt: "desc" },
    take: 50,
  });
  res.json(donations);
});

export const createDonation = catchAsync(async (req: AuthRequest, res: Response) => {
  const { templeName, amount, placeId } = z.object({
    templeName: z.string().min(1),
    amount: z.number().positive(),
    placeId: z.string().optional(),
  }).parse(req.body);
  const donation = await prisma.donation.create({
    data: { userId: req.userId!, templeName, amount, placeId },
  });
  res.status(201).json(donation);
});

// ---- Bookmarks ----

export const getBookmarks = catchAsync(async (req: AuthRequest, res: Response) => {
  const bookmarks = await prisma.bookmark.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
  });
  res.json(bookmarks);
});

export const createBookmark = catchAsync(async (req: AuthRequest, res: Response) => {
  const { placeId, name, address, lat, lon } = z.object({
    placeId: z.string().min(1),
    name: z.string().min(1),
    address: z.string().optional(),
    lat: z.number().optional(),
    lon: z.number().optional(),
  }).parse(req.body);
  const bookmark = await prisma.bookmark.create({
    data: { userId: req.userId!, placeId, name, address, lat, lon },
  });
  res.status(201).json(bookmark);
});

export const deleteBookmark = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.bookmark.deleteMany({
    where: { id: req.params.id, userId: req.userId! },
  });
  res.status(204).send();
});

// ---- Booking history ----

export const getBookingsHistory = catchAsync(async (req: AuthRequest, res: Response) => {
  const bookings = await prisma.booking.findMany({
    where: {
      userId: req.userId!,
      status: { in: ["completed", "cancelled"] },
    },
    include: { priest: { select: { name: true } }, service: { select: { name: true } } },
    orderBy: { scheduledAt: "desc" },
  });
  res.json(bookings);
});
