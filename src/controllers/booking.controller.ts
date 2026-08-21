import { Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { sendPushNotification } from "../services/push.service";

export const listPriests = catchAsync(async (_req: AuthRequest, res: Response) => {
  const priests = await prisma.priest.findMany({
    include: { priestPujas: { include: { puja: true } } },
  });
  res.json(priests);
});

export const getPriestsByPuja = catchAsync(async (req: AuthRequest, res: Response) => {
  const { pujaId } = req.params;
  const priestPujas = await prisma.priestPuja.findMany({
    where: { pujaId },
    include: { priest: { include: { priestPujas: { include: { puja: true } } } } },
  });
  res.json(priestPujas.map((pp) => pp.priest));
});

export const getPriest = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = await prisma.priest.findUnique({
    where: { id: req.params.id },
    include: {
      priestPujas: { include: { puja: true } },
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
  });
  res.json(reviews);
});

export const listBookings = catchAsync(async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string | undefined;
  const where: any = { userId: req.userId! };
  if (status === "upcoming") where.status = { in: ["pending", "confirmed"] };
  if (status === "past") where.status = { in: ["completed", "cancelled"] };

  const bookings = await prisma.booking.findMany({
    where,
    include: { priest: { select: { name: true, userId: true } }, puja: { select: { name: true, icon: true } } },
    orderBy: { scheduledAt: "desc" },
  });
  res.json(bookings);
});

const createBookingSchema = z.object({
  priestId: z.string().min(1),
  pujaId: z.string().min(1),
  scheduledAt: z.string().min(1),
  notes: z.string().optional(),
});

export const createBookingHandler = catchAsync(async (req: AuthRequest, res: Response) => {
  const { priestId, pujaId, scheduledAt, notes } = createBookingSchema.parse(req.body);
  const devotee = await prisma.user.findUnique({ where: { id: req.userId! }, select: { name: true } });

  const puja = await prisma.puja.findUnique({ where: { id: pujaId } });
  if (!puja) throw new AppError("Puja not found", 404);

  const pp = await prisma.priestPuja.findUnique({
    where: { priestId_pujaId: { priestId, pujaId } },
  });
  if (!pp) throw new AppError("This priest does not offer that puja", 400);
  const amount = pp.price || puja.basePrice;

  const booking = await prisma.booking.create({
    data: { userId: req.userId!, priestId, pujaId, scheduledAt: new Date(scheduledAt), amount, notes },
    include: { priest: { select: { name: true, userId: true } }, puja: { select: { name: true, icon: true } } },
  });

  if (booking.priest.userId) {
    sendPushNotification(booking.priest.userId, "New Booking Request",
      `${devotee?.name || "A devotee"} booked "${puja.name}" on ${new Date(scheduledAt).toLocaleDateString()}.`,
      { type: "new_booking", bookingId: booking.id });
  }

  res.status(201).json(booking);
});

export const getBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const booking = await prisma.booking.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: { priest: { select: { name: true, userId: true } }, puja: { select: { name: true, icon: true } } },
  });
  if (!booking) throw new AppError("Booking not found", 404);
  res.json(booking);
});

export const rescheduleBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const { scheduledAt } = z.object({ scheduledAt: z.string().min(1) }).parse(req.body);
  const devotee = await prisma.user.findUnique({ where: { id: req.userId! }, select: { name: true } });
  const result = await prisma.booking.updateMany({
    where: { id: req.params.id, userId: req.userId!, status: { in: ["pending", "confirmed"] } },
    data: { scheduledAt: new Date(scheduledAt) },
  });
  if (result.count === 0) throw new AppError("Booking not found or cannot be rescheduled", 404);
  const updated = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { priest: { select: { userId: true } }, puja: { select: { name: true } } },
  });
  if (updated?.priest?.userId) {
    sendPushNotification(updated.priest.userId, "Booking Rescheduled",
      `${devotee?.name || "A devotee"} rescheduled "${updated.puja.name}".`,
      { type: "booking_rescheduled", bookingId: updated.id });
  }
  res.json(updated);
});

export const cancelBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const devotee = await prisma.user.findUnique({ where: { id: req.userId! }, select: { name: true } });
  const result = await prisma.booking.updateMany({
    where: { id: req.params.id, userId: req.userId!, status: { in: ["pending", "confirmed"] } },
    data: { status: "cancelled" },
  });
  if (result.count === 0) throw new AppError("Booking not found or cannot be cancelled", 404);
  const updated = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { priest: { select: { userId: true } }, puja: { select: { name: true } } },
  });
  if (updated?.priest?.userId) {
    sendPushNotification(updated.priest.userId, "Booking Cancelled",
      `${devotee?.name || "A devotee"} cancelled "${updated.puja.name}".`,
      { type: "booking_cancelled", bookingId: updated.id });
  }
  res.json(updated);
});

export const payForBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const result = await prisma.booking.updateMany({
    where: { id: req.params.id, userId: req.userId!, status: "pending" },
    data: { paid: true, status: "confirmed" },
  });
  if (result.count === 0) throw new AppError("Booking not found or already paid", 404);
  res.json(await prisma.booking.findUnique({ where: { id: req.params.id } }));
});
