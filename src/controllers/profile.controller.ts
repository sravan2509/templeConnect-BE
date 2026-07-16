import { Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import {
  bookings,
  checkins,
  donations,
  getNotificationPreferences,
  getSubscription,
  notificationPreferencesByUser,
  subscriptionsByUser,
} from "../data/mockStore";
import { randomUUID } from "crypto";

// ---- Real: basic profile ----

export const getMe = catchAsync(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, name: true, email: true } });
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

// ---- Mock: support ----

const faqs = [
  { id: "faq-1", question: "How do I book a priest?", answer: "Go to Connect → Priest Directory, pick a priest, and follow the booking flow." },
  { id: "faq-2", question: "Can I cancel a booking?", answer: "Yes, from Connect → My Bookings → Upcoming Bookings." },
];

export const getFaqs = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.json(faqs);
});

export const createSupportTicket = catchAsync(async (req: AuthRequest, res: Response) => {
  const { message } = z.object({ message: z.string().min(1) }).parse(req.body);
  res.status(201).json({ id: `ticket-${randomUUID()}`, message, status: "open" });
});

// ---- Mock: notification preferences ----

export const getNotificationPrefs = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(getNotificationPreferences(req.userId!));
});

export const updateNotificationPrefs = catchAsync(async (req: AuthRequest, res: Response) => {
  const current = getNotificationPreferences(req.userId!);
  const updated = { ...current, ...req.body };
  notificationPreferencesByUser.set(req.userId!, updated);
  res.json(updated);
});

// ---- Mock: account security ----

export const changePassword = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, message: "Password updated (mock)" });
});

export const get2fa = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.json({ enabled: false });
});

export const enable2fa = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.json({ enabled: true });
});

export const getDevices = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.json([{ id: "device-1", name: "This device", lastActive: new Date().toISOString() }]);
});

export const deleteAccount = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, message: "Account deletion requested (mock)" });
});

// ---- Mock: subscriptions / payments ----

export const getPlan = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(getSubscription(req.userId!));
});

export const upgradePlan = catchAsync(async (req: AuthRequest, res: Response) => {
  const { plan } = z.object({ plan: z.enum(["premium_monthly", "premium_yearly"]) }).parse(req.body);
  const sub = getSubscription(req.userId!);
  sub.plan = plan;
  sub.renewsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  subscriptionsByUser.set(req.userId!, sub);
  res.json(sub);
});

export const updatePaymentMethod = catchAsync(async (req: AuthRequest, res: Response) => {
  const { paymentMethod } = z.object({ paymentMethod: z.string().min(1) }).parse(req.body);
  const sub = getSubscription(req.userId!);
  sub.paymentMethod = paymentMethod;
  subscriptionsByUser.set(req.userId!, sub);
  res.json(sub);
});

export const cancelSubscription = catchAsync(async (req: AuthRequest, res: Response) => {
  const sub = getSubscription(req.userId!);
  sub.plan = "free";
  sub.renewsAt = null;
  subscriptionsByUser.set(req.userId!, sub);
  res.json(sub);
});

// ---- Mock: activity / check-ins / donations ----

export const getBookingsHistory = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(bookings.filter((b) => b.userId === req.userId && (b.status === "completed" || b.status === "cancelled")));
});

export const getCheckins = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(checkins.filter((c) => c.userId === req.userId));
});

export const createCheckin = catchAsync(async (req: AuthRequest, res: Response) => {
  const { templeName } = z.object({ templeName: z.string().min(1) }).parse(req.body);
  const checkin = { id: `checkin-${randomUUID()}`, userId: req.userId!, templeName, visitedAt: new Date().toISOString() };
  checkins.push(checkin);
  res.status(201).json(checkin);
});

export const getDonations = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(donations.filter((d) => d.userId === req.userId));
});

export const createDonation = catchAsync(async (req: AuthRequest, res: Response) => {
  const { templeName, amount } = z.object({ templeName: z.string().min(1), amount: z.number().positive() }).parse(req.body);
  const donation = { id: `donation-${randomUUID()}`, userId: req.userId!, templeName, amount, donatedAt: new Date().toISOString() };
  donations.push(donation);
  res.status(201).json(donation);
});
