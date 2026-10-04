import { Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";

const meSelect = { id: true, name: true, email: true, role: true, createdAt: true, passwordHash: true, googleId: true, avatarUrl: true } as const;

type MeRow = { id: string; name: string; email: string; role: string; createdAt: Date; passwordHash: string | null; googleId: string | null; avatarUrl: string | null };

/** Never send the password hash or Google ID to the app, only whether they exist. */
function toMe(u: MeRow) {
  const { passwordHash, googleId, ...rest } = u;
  return { ...rest, hasPassword: !!passwordHash, googleLinked: !!googleId };
}

export const getMe = catchAsync(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: meSelect });
  if (!user) throw new AppError("User not found", 404);
  res.json(toMe(user));
});

export const updateMe = catchAsync(async (req: AuthRequest, res: Response) => {
  const { name } = z.object({ name: z.string().trim().min(1, "Name is required").max(100) }).strict().parse(req.body);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: req.userId! }, data: { name }, select: meSelect });
    // Keep a priest's public name in sync with their account name.
    await tx.priest.updateMany({ where: { userId: req.userId! }, data: { name } });
    return u;
  });
  res.json(toMe(user));
});

/** Permanently deletes the account. Requires the current password. */
export const deleteAccount = catchAsync(async (req: AuthRequest, res: Response) => {
  const { password, confirmText } = z.object({ password: z.string().optional(), confirmText: z.string().optional() }).parse(req.body ?? {});
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, include: { priestProfile: true } });
  if (!user) throw new AppError("User not found", 404);
  if (user.passwordHash) {
    if (!password) throw new AppError("Enter your password to confirm", 400);
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new AppError("Incorrect password", 400);
  } else if (confirmText?.trim().toUpperCase() !== "DELETE") {
    // Google-only accounts have no password; typing DELETE confirms instead.
    throw new AppError("Type DELETE to confirm", 400);
  }
  if (user.role === "admin" && (await prisma.user.count({ where: { role: "admin" } })) <= 1) {
    throw new AppError("You are the only admin. Promote another admin before deleting this account.", 400);
  }
  if (user.priestProfile) {
    const open = await prisma.booking.count({ where: { priestId: user.priestProfile.id, status: { in: ["pending", "confirmed"] } } });
    if (open > 0) throw new AppError(`You have ${open} open booking(s). Please complete or decline them first.`, 400);
  }
  await prisma.user.delete({ where: { id: user.id } });
  res.json({ success: true, message: "Account deleted" });
});

// ── Notification preferences ──

const prefsSchema = z.object({
  pujaReminders: z.boolean(),
  templeEventAlerts: z.boolean(),
  bookingUpdates: z.boolean(),
  promotionalOffers: z.boolean(),
  dailySuggestions: z.boolean(),
}).partial().strict();

const prefsSelect = { pujaReminders: true, templeEventAlerts: true, bookingUpdates: true, promotionalOffers: true, dailySuggestions: true } as const;

export const getNotificationPrefs = catchAsync(async (req: AuthRequest, res: Response) => {
  const prefs = await prisma.notificationPreference.upsert({
    where: { userId: req.userId! }, create: { userId: req.userId! }, update: {}, select: prefsSelect,
  });
  res.json(prefs);
});

export const updateNotificationPrefs = catchAsync(async (req: AuthRequest, res: Response) => {
  const data = prefsSchema.parse(req.body);
  const prefs = await prisma.notificationPreference.upsert({
    where: { userId: req.userId! }, create: { userId: req.userId!, ...data }, update: data, select: prefsSelect,
  });
  res.json(prefs);
});

// ── Subscriptions ──
// NOTE: no payment gateway is integrated, so upgrades are recorded without charging.

export const getPlan = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(await prisma.subscription.upsert({ where: { userId: req.userId! }, create: { userId: req.userId! }, update: {} }));
});

export const upgradePlan = catchAsync(async (req: AuthRequest, res: Response) => {
  const { plan } = z.object({ plan: z.enum(["premium_monthly", "premium_yearly"]) }).parse(req.body);
  const days = plan === "premium_yearly" ? 365 : 30;
  const renewsAt = new Date(Date.now() + days * 86400000);
  res.json(await prisma.subscription.upsert({
    where: { userId: req.userId! }, create: { userId: req.userId!, plan, renewsAt }, update: { plan, renewsAt },
  }));
});

export const updatePaymentMethod = catchAsync(async (req: AuthRequest, res: Response) => {
  const { paymentMethod } = z.object({ paymentMethod: z.string().trim().min(1).max(100) }).parse(req.body);
  res.json(await prisma.subscription.upsert({
    where: { userId: req.userId! }, create: { userId: req.userId!, paymentMethod }, update: { paymentMethod },
  }));
});

export const cancelSubscription = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(await prisma.subscription.upsert({
    where: { userId: req.userId! }, create: { userId: req.userId! }, update: { plan: "free", renewsAt: null },
  }));
});

// ── Activity: check-ins / donations ──

export const getCheckins = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(await prisma.checkin.findMany({ where: { userId: req.userId! }, orderBy: { visitedAt: "desc" }, take: 100 }));
});

export const createCheckin = catchAsync(async (req: AuthRequest, res: Response) => {
  const { templeName, placeId, lat, lon } = z.object({
    templeName: z.string().trim().min(1).max(200),
    placeId: z.string().max(300).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
  }).parse(req.body);
  // One check-in per temple per day.
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  if (placeId) {
    const already = await prisma.checkin.findFirst({ where: { userId: req.userId!, placeId, visitedAt: { gte: startOfDay } } });
    if (already) throw new AppError("You have already checked in here today", 409);
  }
  res.status(201).json(await prisma.checkin.create({ data: { userId: req.userId!, templeName, placeId, lat, lon } }));
});

export const getDonations = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(await prisma.donation.findMany({ where: { userId: req.userId! }, orderBy: { donatedAt: "desc" }, take: 100 }));
});

/** Donations can only be recorded once a payment gateway confirms the payment. */
export const createDonation = catchAsync(async (_req: AuthRequest, _res: Response) => {
  throw new AppError("Online donations are not available yet", 501);
});

// ── Bookmarks ──

export const getBookmarks = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(await prisma.bookmark.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: "desc" } }));
});

export const createBookmark = catchAsync(async (req: AuthRequest, res: Response) => {
  const data = z.object({
    placeId: z.string().min(1).max(300),
    name: z.string().trim().min(1).max(200),
    address: z.string().max(500).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
  }).parse(req.body);
  // Saving twice is a no-op rather than a duplicate.
  const bookmark = await prisma.bookmark.upsert({
    where: { userId_placeId: { userId: req.userId!, placeId: data.placeId } },
    create: { userId: req.userId!, ...data },
    update: {},
  });
  res.status(201).json(bookmark);
});

export const deleteBookmark = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.bookmark.deleteMany({ where: { id: req.params.id, userId: req.userId! } });
  res.status(204).send();
});

// ── Booking history ──

export const getBookingsHistory = catchAsync(async (req: AuthRequest, res: Response) => {
  const [bookings, reviews] = await Promise.all([
    prisma.booking.findMany({
      where: { userId: req.userId!, status: { in: ["completed", "cancelled"] } },
      include: { priest: { select: { name: true, userId: true } }, puja: { select: { name: true, icon: true } } },
      orderBy: { scheduledAt: "desc" },
    }),
    prisma.priestReview.findMany({ where: { userId: req.userId! }, select: { priestId: true } }),
  ]);
  const reviewed = new Set(reviews.map((r) => r.priestId));
  res.json(bookings.map((b) => ({ ...b, reviewed: reviewed.has(b.priestId) })));
});
