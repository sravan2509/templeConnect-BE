import { Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { sendPushNotification } from "../services/push.service";

// ── ADMIN DASHBOARD ──────────────────────────────────────────

export const adminDashboard = catchAsync(async (_req: AuthRequest, res: Response) => {
  const [users, priests, pujas, bookings, donations] = await Promise.all([
    prisma.user.count(), prisma.priest.count(), prisma.puja.count(),
    prisma.booking.count(), prisma.donation.count(),
  ]);
  const recentBookings = await prisma.booking.findMany({
    take: 10, orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true } }, priest: { select: { name: true } }, puja: { select: { name: true } } },
  });
  res.json({ stats: { users, priests, pujas, bookings, donations }, recentBookings });
});

// ── PUJA CRUD ───────────────────────────────────────────────

export const listPujas = catchAsync(async (_req: AuthRequest, res: Response) => {
  const pujas = await prisma.puja.findMany({ orderBy: { category: "asc" } });
  res.json(pujas);
});

const pujaSchema = z.object({
  name: z.string().min(1), description: z.string().optional(),
  duration: z.string().optional(), basePrice: z.number().optional(),
  category: z.string().optional(), icon: z.string().optional(),
});

export const createPuja = catchAsync(async (req: AuthRequest, res: Response) => {
  const data = pujaSchema.parse(req.body);
  const existing = await prisma.puja.findUnique({ where: { name: data.name } });
  if (existing) throw new AppError("Puja with this name already exists", 409);
  const puja = await prisma.puja.create({ data });
  res.status(201).json(puja);
});

export const updatePuja = catchAsync(async (req: AuthRequest, res: Response) => {
  const puja = await prisma.puja.update({ where: { id: req.params.id }, data: req.body });
  res.json(puja);
});

export const deletePuja = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.puja.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// ── PRIEST MANAGEMENT ───────────────────────────────────────

const createPriestSchema = z.object({
  name: z.string().min(1), phone: z.string().optional(),
  specialization: z.string().optional(), languages: z.string().optional(),
  experienceYears: z.number().optional(), qualifications: z.string().optional(),
  bio: z.string().optional(), email: z.string().email().optional(),
  password: z.string().min(8).optional(), pujaIds: z.array(z.string()).optional(),
});

export const createPriest = catchAsync(async (req: AuthRequest, res: Response) => {
  const data = createPriestSchema.parse(req.body);
  let userId: string | null = null;

  if (data.email && data.password) {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new AppError("Email already in use", 409);
    const bcrypt = require("bcryptjs");
    const hash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: { name: data.name, email: data.email, passwordHash: hash, role: "priest" },
    });
    userId = user.id;
  }

  const priest = await prisma.priest.create({
    data: {
      userId, name: data.name, phone: data.phone,
      specialization: data.specialization || "", languages: data.languages || "",
      experienceYears: data.experienceYears || 0, qualifications: data.qualifications || "", bio: data.bio,
    },
  });

  if (data.pujaIds?.length) {
    for (const pujaId of data.pujaIds) {
      await prisma.priestPuja.create({ data: { priestId: priest.id, pujaId } });
    }
  }

  res.status(201).json(priest);
});

export const updatePriest = catchAsync(async (req: AuthRequest, res: Response) => {
  const { pujaIds, ...priestData } = req.body;
  const priest = await prisma.priest.update({ where: { id: req.params.id }, data: priestData });

  if (pujaIds !== undefined) {
    await prisma.priestPuja.deleteMany({ where: { priestId: priest.id } });
    if (Array.isArray(pujaIds)) {
      for (const pujaId of pujaIds) {
        await prisma.priestPuja.create({ data: { priestId: priest.id, pujaId } });
      }
    }
  }

  res.json(priest);
});

export const deletePriest = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.priest.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// ── PRIEST SELF-SERVICE ─────────────────────────────────────

export const getPriestProfile = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = await prisma.priest.findFirst({
    where: { userId: req.userId! },
    include: { priestPujas: { include: { puja: true } } },
  });
  if (!priest) throw new AppError("Priest profile not found", 404);
  res.json(priest);
});

export const updatePriestProfile = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = await prisma.priest.findFirst({ where: { userId: req.userId! } });
  if (!priest) throw new AppError("Priest profile not found", 404);

  const { pujaIds, ...profileData } = req.body;
  await prisma.priest.update({ where: { id: priest.id }, data: profileData });

  if (pujaIds !== undefined) {
    await prisma.priestPuja.deleteMany({ where: { priestId: priest.id } });
    if (Array.isArray(pujaIds)) {
      for (const pujaId of pujaIds) {
        await prisma.priestPuja.create({ data: { priestId: priest.id, pujaId } });
      }
    }
  }

  const updated = await prisma.priest.findUnique({
    where: { id: priest.id },
    include: { priestPujas: { include: { puja: true } } },
  });
  res.json(updated);
});

export const getPriestStats = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = await prisma.priest.findFirst({ where: { userId: req.userId! } });
  if (!priest) throw new AppError("Priest profile not found", 404);

  const [bookings, pending, confirmed, completed] = await Promise.all([
    prisma.booking.count({ where: { priestId: priest.id } }),
    prisma.booking.count({ where: { priestId: priest.id, status: "pending" } }),
    prisma.booking.count({ where: { priestId: priest.id, status: "confirmed" } }),
    prisma.booking.count({ where: { priestId: priest.id, status: "completed" } }),
  ]);

  const upcoming = await prisma.booking.findMany({
    where: { priestId: priest.id, status: { in: ["pending", "confirmed"] } },
    include: { user: { select: { name: true } }, puja: { select: { name: true, icon: true } } },
    orderBy: { scheduledAt: "asc" }, take: 10,
  });

  res.json({ stats: { total: bookings, pending, confirmed, completed }, upcoming, priest });
});

// ── BOOKING MANAGEMENT ──────────────────────────────────────

export const acceptBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = await prisma.priest.findFirst({ where: { userId: req.userId! } });
  if (!priest) throw new AppError("Priest profile not found", 404);

  const result = await prisma.booking.updateMany({
    where: { id: req.params.id, priestId: priest.id, status: "pending" },
    data: { status: "confirmed" },
  });
  if (result.count === 0) throw new AppError("Booking not found or not pending", 404);

  const updated = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { name: true, id: true } }, puja: { select: { name: true } } },
  });

  sendPushNotification(updated!.userId, "Booking Confirmed",
    `Your booking with ${priest.name} for "${updated!.puja.name}" on ${new Date(updated!.scheduledAt).toLocaleDateString()} has been confirmed.`,
    { type: "booking_confirmed", bookingId: updated!.id });

  res.json(updated);
});

export const rejectBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = await prisma.priest.findFirst({ where: { userId: req.userId! } });
  if (!priest) throw new AppError("Priest profile not found", 404);

  const result = await prisma.booking.updateMany({
    where: { id: req.params.id, priestId: priest.id, status: "pending" },
    data: { status: "cancelled" },
  });
  if (result.count === 0) throw new AppError("Booking not found or not pending", 404);

  const updated = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { name: true, id: true } }, puja: { select: { name: true } } },
  });

  sendPushNotification(updated!.userId, "Booking Declined",
    `Your booking with ${priest.name} for "${updated!.puja.name}" has been declined.`,
    { type: "booking_declined", bookingId: updated!.id });

  res.json({ message: "Booking rejected" });
});

export const registerPushToken = catchAsync(async (req: AuthRequest, res: Response) => {
  const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
  await prisma.user.update({ where: { id: req.userId! }, data: { pushToken: token } });
  res.json({ success: true });
});
