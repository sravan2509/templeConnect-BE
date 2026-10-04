import { Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { sendPushNotification } from "../services/push.service";

/** Devotees can cancel a confirmed booking free of charge up to this long before it starts. */
export const CANCELLATION_WINDOW_HOURS = 24;
/** Bookings closer together than this for the same priest are treated as a clash. */
const SLOT_MINUTES = 60;
const MAX_ADVANCE_DAYS = 365;

const bookingInclude = {
  priest: { select: { name: true, userId: true, phone: true } },
  puja: { select: { name: true, icon: true, duration: true } },
} as const;

const priestPublicSelect = {
  id: true, name: true, specialization: true, languages: true, rating: true, reviewCount: true,
  verified: true, experienceYears: true, qualifications: true, bio: true, avatar: true,
  priestPujas: { include: { puja: true } },
} as const;

// ── Priests (public to logged-in users) ─────────────────────

export const listPriests = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.json(await prisma.priest.findMany({ select: { ...priestPublicSelect, phone: true, userId: true }, orderBy: { name: "asc" } }));
});

export const getPriestsByPuja = catchAsync(async (req: AuthRequest, res: Response) => {
  const priestPujas = await prisma.priestPuja.findMany({
    where: { pujaId: req.params.pujaId, puja: { active: true } },
    include: { priest: { select: priestPublicSelect } },
  });
  // Expose the price this priest charges for the selected puja.
  res.json(priestPujas.map((pp) => ({ ...pp.priest, price: pp.price })));
});

export const getPriest = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = await prisma.priest.findUnique({
    where: { id: req.params.id },
    select: {
      ...priestPublicSelect,
      reviews: { take: 10, orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
    },
  });
  if (!priest) throw new AppError("Priest not found", 404);
  res.json(priest);
});

export const getPriestReviews = catchAsync(async (req: AuthRequest, res: Response) => {
  const reviews = await prisma.priestReview.findMany({
    where: { priestId: req.params.id },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(reviews);
});

export const submitReview = catchAsync(async (req: AuthRequest, res: Response) => {
  const { rating, comment } = z.object({
    rating: z.number().int("Rating must be a whole number").min(1).max(5),
    comment: z.string().trim().max(1000).optional(),
  }).parse(req.body);
  const priestId = req.params.id;
  const priest = await prisma.priest.findUnique({ where: { id: priestId } });
  if (!priest) throw new AppError("Priest not found", 404);

  const completed = await prisma.booking.findFirst({ where: { userId: req.userId!, priestId, status: "completed" } });
  if (!completed) throw new AppError("You can only review a priest after a completed puja", 400);

  const existing = await prisma.priestReview.findFirst({ where: { userId: req.userId!, priestId } });
  if (existing) throw new AppError("You have already reviewed this priest", 409);

  // Running average keeps ratings carried over from before reviews were tracked in-app.
  const newCount = priest.reviewCount + 1;
  const newRating = Math.round(((priest.rating * priest.reviewCount + rating) / newCount) * 10) / 10;
  await prisma.$transaction([
    prisma.priestReview.create({ data: { priestId, userId: req.userId!, rating, comment: comment || null } }),
    prisma.priest.update({ where: { id: priestId }, data: { rating: newRating, reviewCount: newCount } }),
  ]);

  res.status(201).json({ message: "Review submitted", newRating, reviewCount: newCount });
});

// ── Bookings (devotee) ──────────────────────────────────────

function parseSchedule(value: string): Date {
  const date = new Date(value);
  if (isNaN(date.getTime())) throw new AppError("Invalid date/time", 400);
  if (date.getTime() < Date.now() + 30 * 60 * 1000) throw new AppError("Please choose a time at least 30 minutes from now", 400);
  if (date.getTime() > Date.now() + MAX_ADVANCE_DAYS * 86400000) throw new AppError("Bookings can be made at most one year in advance", 400);
  return date;
}

async function assertSlotFree(priestId: string, scheduledAt: Date, excludeBookingId?: string) {
  const window = SLOT_MINUTES * 60 * 1000;
  const clash = await prisma.booking.findFirst({
    where: {
      priestId,
      status: { in: ["pending", "confirmed"] },
      scheduledAt: { gt: new Date(scheduledAt.getTime() - window), lt: new Date(scheduledAt.getTime() + window) },
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    },
  });
  if (clash) throw new AppError("The priest already has a booking around this time. Please pick another slot.", 409);
}

export const listBookings = catchAsync(async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string | undefined;
  const where: any = { userId: req.userId! };
  if (status === "upcoming") where.status = { in: ["pending", "confirmed"] };
  if (status === "past") where.status = { in: ["completed", "cancelled"] };

  const [bookings, reviews] = await Promise.all([
    prisma.booking.findMany({ where, include: bookingInclude, orderBy: { scheduledAt: status === "upcoming" ? "asc" : "desc" } }),
    prisma.priestReview.findMany({ where: { userId: req.userId! }, select: { priestId: true } }),
  ]);
  const reviewed = new Set(reviews.map((r) => r.priestId));
  res.json(bookings.map((b) => ({ ...b, reviewed: reviewed.has(b.priestId) })));
});

const createBookingSchema = z.object({
  priestId: z.string().min(1),
  pujaId: z.string().min(1),
  scheduledAt: z.string().min(1),
  notes: z.string().trim().max(500).optional(),
});

export const createBookingHandler = catchAsync(async (req: AuthRequest, res: Response) => {
  const { priestId, pujaId, scheduledAt, notes } = createBookingSchema.parse(req.body);
  const when = parseSchedule(scheduledAt);

  const puja = await prisma.puja.findUnique({ where: { id: pujaId } });
  if (!puja || !puja.active) throw new AppError("Puja not found", 404);

  const pp = await prisma.priestPuja.findUnique({
    where: { priestId_pujaId: { priestId, pujaId } },
    include: { priest: { select: { userId: true } } },
  });
  if (!pp) throw new AppError("This priest does not offer that puja", 400);
  if (pp.priest.userId === req.userId) throw new AppError("You cannot book yourself", 400);
  await assertSlotFree(priestId, when);

  const booking = await prisma.booking.create({
    data: { userId: req.userId!, priestId, pujaId, scheduledAt: when, amount: pp.price ?? puja.basePrice, notes: notes || null },
    include: bookingInclude,
  });

  if (booking.priest.userId) {
    const devotee = await prisma.user.findUnique({ where: { id: req.userId! }, select: { name: true } });
    void sendPushNotification(booking.priest.userId, "New Booking Request",
      `${devotee?.name || "A devotee"} requested "${puja.name}" on ${when.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.`,
      { type: "new_booking", bookingId: booking.id });
  }

  res.status(201).json(booking);
});

/** Booking detail for the devotee who made it or the priest it was made with. */
export const getBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const booking = await prisma.booking.findFirst({
    where: { id: req.params.id, OR: [{ userId: req.userId! }, { priest: { userId: req.userId! } }] },
    include: { ...bookingInclude, user: { select: { id: true, name: true } } },
  });
  if (!booking) throw new AppError("Booking not found", 404);
  res.json(booking);
});

export const rescheduleBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const { scheduledAt } = z.object({ scheduledAt: z.string().min(1) }).parse(req.body);
  const when = parseSchedule(scheduledAt);
  const booking = await prisma.booking.findFirst({
    where: { id: req.params.id, userId: req.userId!, status: { in: ["pending", "confirmed"] } },
  });
  if (!booking) throw new AppError("Booking not found or cannot be rescheduled", 404);
  await assertSlotFree(booking.priestId, when, booking.id);

  // A new time needs the priest's approval again.
  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { scheduledAt: when, status: "pending" },
    include: bookingInclude,
  });
  if (updated.priest.userId) {
    const devotee = await prisma.user.findUnique({ where: { id: req.userId! }, select: { name: true } });
    void sendPushNotification(updated.priest.userId, "Booking Rescheduled",
      `${devotee?.name || "A devotee"} moved "${updated.puja.name}" to ${when.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}. Please confirm.`,
      { type: "booking_rescheduled", bookingId: updated.id });
  }
  res.json(updated);
});

export const cancelBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const booking = await prisma.booking.findFirst({
    where: { id: req.params.id, userId: req.userId!, status: { in: ["pending", "confirmed"] } },
  });
  if (!booking) throw new AppError("Booking not found or cannot be cancelled", 404);
  if (booking.status === "confirmed" && booking.scheduledAt.getTime() - Date.now() < CANCELLATION_WINDOW_HOURS * 3600 * 1000) {
    throw new AppError(`Confirmed bookings can only be cancelled at least ${CANCELLATION_WINDOW_HOURS} hours in advance. Please chat with your priest.`, 400);
  }

  const updated = await prisma.booking.update({ where: { id: booking.id }, data: { status: "cancelled" }, include: bookingInclude });
  if (updated.priest.userId) {
    const devotee = await prisma.user.findUnique({ where: { id: req.userId! }, select: { name: true } });
    void sendPushNotification(updated.priest.userId, "Booking Cancelled",
      `${devotee?.name || "A devotee"} cancelled "${updated.puja.name}".`,
      { type: "booking_cancelled", bookingId: updated.id });
  }
  res.json(updated);
});

/**
 * Records payment for a booking the priest has confirmed.
 * NOTE: no payment gateway is integrated yet — this records a simulated payment.
 * Replace with gateway order creation + signature verification before launch.
 */
export const payForBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const booking = await prisma.booking.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!booking) throw new AppError("Booking not found", 404);
  if (booking.paid) throw new AppError("This booking is already paid", 409);
  if (booking.status !== "confirmed") throw new AppError("You can pay once the priest has confirmed the booking", 400);

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { paid: true, paymentId: `SIMULATED-${randomUUID()}` },
    include: bookingInclude,
  });
  res.json(updated);
});
