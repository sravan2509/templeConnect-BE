import { Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { sendPushNotification } from "../services/push.service";

const fmtIST = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

// ── ADMIN DASHBOARD ──────────────────────────────────────────

export const adminDashboard = catchAsync(async (_req: AuthRequest, res: Response) => {
  const [users, priests, pujas, bookings, donations, temples] = await Promise.all([
    prisma.user.count(), prisma.priest.count(), prisma.puja.count({ where: { active: true } }),
    prisma.booking.count(), prisma.donation.count(), prisma.temple.count({ where: { source: { in: ["upload", "import", "admin"] } } }),
  ]);
  const recentBookings = await prisma.booking.findMany({
    take: 10, orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true } }, priest: { select: { name: true } }, puja: { select: { name: true } } },
  });
  res.json({ stats: { users, priests, pujas, bookings, donations, temples }, recentBookings });
});

// ── PUJA CRUD ───────────────────────────────────────────────

export const listPujas = catchAsync(async (req: AuthRequest, res: Response) => {
  // Admins also see deactivated pujas so they can re-enable them.
  const where = req.userRole === "admin" ? {} : { active: true };
  res.json(await prisma.puja.findMany({ where, orderBy: [{ category: "asc" }, { name: "asc" }] }));
});

const pujaSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  duration: z.string().trim().max(50).optional(),
  basePrice: z.number().positive().max(1_000_000).optional(),
  category: z.string().trim().min(1).max(50).optional(),
  icon: z.string().trim().max(8).optional(),
  active: z.boolean().optional(),
}).strict();

export const createPuja = catchAsync(async (req: AuthRequest, res: Response) => {
  const data = pujaSchema.parse(req.body);
  const existing = await prisma.puja.findUnique({ where: { name: data.name } });
  if (existing) throw new AppError("Puja with this name already exists", 409);
  res.status(201).json(await prisma.puja.create({ data }));
});

export const updatePuja = catchAsync(async (req: AuthRequest, res: Response) => {
  const data = pujaSchema.partial().parse(req.body);
  res.json(await prisma.puja.update({ where: { id: req.params.id }, data }));
});

/** Pujas with booking history are deactivated instead of deleted so past bookings stay intact. */
export const deletePuja = catchAsync(async (req: AuthRequest, res: Response) => {
  const bookingCount = await prisma.booking.count({ where: { pujaId: req.params.id } });
  if (bookingCount > 0) {
    const puja = await prisma.puja.update({ where: { id: req.params.id }, data: { active: false } });
    return res.json({ deactivated: true, message: `"${puja.name}" has bookings, so it was hidden instead of deleted.` });
  }
  await prisma.puja.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// ── PRIEST MANAGEMENT ───────────────────────────────────────

const priestFields = {
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(30).optional(),
  specialization: z.string().trim().max(200).optional(),
  languages: z.string().trim().max(200).optional(),
  experienceYears: z.number().int().min(0).max(100).optional(),
  qualifications: z.string().trim().max(500).optional(),
  bio: z.string().trim().max(2000).optional(),
  pujaIds: z.array(z.string()).max(100).optional(),
};

const createPriestSchema = z.object({
  ...priestFields,
  verified: z.boolean().optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  password: z.string().min(8, "Password must be at least 8 characters").optional().or(z.literal("")),
}).strict();

const adminUpdatePriestSchema = z.object({ ...priestFields, verified: z.boolean().optional() }).partial().strict();
const selfUpdatePriestSchema = z.object(priestFields).partial().strict();

async function setPriestPujas(tx: typeof prisma | any, priestId: string, pujaIds: string[]) {
  const unique = [...new Set(pujaIds)];
  const found = await tx.puja.count({ where: { id: { in: unique } } });
  if (found !== unique.length) throw new AppError("One or more selected pujas do not exist", 400);
  await tx.priestPuja.deleteMany({ where: { priestId, pujaId: { notIn: unique } } });
  for (const pujaId of unique) {
    await tx.priestPuja.upsert({
      where: { priestId_pujaId: { priestId, pujaId } },
      update: {},
      create: { priestId, pujaId },
    });
  }
}

export const createPriest = catchAsync(async (req: AuthRequest, res: Response) => {
  const { email, password, pujaIds, ...data } = createPriestSchema.parse(req.body);
  if (!!email !== !!password) throw new AppError("Provide both email and password to create a login for the priest", 400);
  const lowerEmail = email ? email.toLowerCase() : null;
  if (lowerEmail && (await prisma.user.findUnique({ where: { email: lowerEmail } }))) {
    throw new AppError("Email already in use", 409);
  }

  const priest = await prisma.$transaction(async (tx) => {
    let userId: string | null = null;
    if (lowerEmail && password) {
      const user = await tx.user.create({
        data: { name: data.name, email: lowerEmail, passwordHash: await bcrypt.hash(password, 10), role: "priest" },
      });
      userId = user.id;
    }
    const created = await tx.priest.create({
      data: {
        userId, name: data.name, phone: data.phone || null, specialization: data.specialization ?? "",
        languages: data.languages ?? "", experienceYears: data.experienceYears ?? 0,
        qualifications: data.qualifications ?? "", bio: data.bio || null, verified: data.verified ?? false,
      },
    });
    if (pujaIds?.length) await setPriestPujas(tx, created.id, pujaIds);
    return created;
  });

  res.status(201).json(priest);
});

export const updatePriest = catchAsync(async (req: AuthRequest, res: Response) => {
  const { pujaIds, ...data } = adminUpdatePriestSchema.parse(req.body);
  const priest = await prisma.$transaction(async (tx) => {
    const updated = await tx.priest.update({ where: { id: req.params.id }, data });
    if (pujaIds !== undefined) await setPriestPujas(tx, updated.id, pujaIds);
    return updated;
  });
  res.json(priest);
});

export const deletePriest = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = await prisma.priest.findUnique({ where: { id: req.params.id } });
  if (!priest) throw new AppError("Priest not found", 404);
  const bookings = await prisma.booking.count({ where: { priestId: priest.id } });
  if (bookings > 0) {
    throw new AppError(`This priest has ${bookings} booking(s) and cannot be deleted. Remove their pujas instead so they get no new bookings.`, 409);
  }
  await prisma.$transaction(async (tx) => {
    await tx.priest.delete({ where: { id: priest.id } });
    // The linked login loses priest access but keeps its account.
    if (priest.userId) await tx.user.update({ where: { id: priest.userId }, data: { role: "devotee", tokenVersion: { increment: 1 } } });
  });
  res.status(204).send();
});

// ── PRIEST SELF-SERVICE ─────────────────────────────────────

async function myPriest(userId: string) {
  const priest = await prisma.priest.findFirst({ where: { userId } });
  if (!priest) throw new AppError("Priest profile not found", 404);
  return priest;
}

export const getPriestProfile = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = await myPriest(req.userId!);
  res.json(await prisma.priest.findUnique({ where: { id: priest.id }, include: { priestPujas: { include: { puja: true } } } }));
});

/** Priests may edit their own descriptive fields only — never rating, reviews or verification. */
export const updatePriestProfile = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = await myPriest(req.userId!);
  const { pujaIds, ...data } = selfUpdatePriestSchema.parse(req.body);
  await prisma.$transaction(async (tx) => {
    await tx.priest.update({ where: { id: priest.id }, data });
    if (data.name) await tx.user.update({ where: { id: req.userId! }, data: { name: data.name } });
    if (pujaIds !== undefined) await setPriestPujas(tx, priest.id, pujaIds);
  });
  res.json(await prisma.priest.findUnique({ where: { id: priest.id }, include: { priestPujas: { include: { puja: true } } } }));
});

export const getPriestStats = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = await myPriest(req.userId!);
  const [total, pending, confirmed, completed] = await Promise.all([
    prisma.booking.count({ where: { priestId: priest.id } }),
    prisma.booking.count({ where: { priestId: priest.id, status: "pending" } }),
    prisma.booking.count({ where: { priestId: priest.id, status: "confirmed" } }),
    prisma.booking.count({ where: { priestId: priest.id, status: "completed" } }),
  ]);

  const upcoming = await prisma.booking.findMany({
    where: { priestId: priest.id, status: { in: ["pending", "confirmed"] } },
    include: { user: { select: { id: true, name: true } }, puja: { select: { name: true, icon: true, duration: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 50,
  });

  res.json({ stats: { total, pending, confirmed, completed }, upcoming, priest });
});

// ── BOOKING MANAGEMENT (priest) ─────────────────────────────

async function transitionBooking(req: AuthRequest, from: string, to: string, extra: object = {}) {
  const priest = await myPriest(req.userId!);
  const booking = await prisma.booking.findFirst({ where: { id: req.params.id, priestId: priest.id } });
  if (!booking) throw new AppError("Booking not found", 404);
  if (booking.status !== from) throw new AppError(`Only ${from} bookings can be marked ${to}`, 400);
  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { status: to, ...extra },
    include: { user: { select: { name: true, id: true } }, puja: { select: { name: true } } },
  });
  return { priest, updated };
}

export const acceptBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const pending = await prisma.booking.findUnique({ where: { id: req.params.id }, select: { scheduledAt: true } });
  if (pending && pending.scheduledAt.getTime() <= Date.now()) {
    throw new AppError("This booking's time has already passed. Please decline it so the devotee can rebook.", 400);
  }
  const { priest, updated } = await transitionBooking(req, "pending", "confirmed");
  void sendPushNotification(updated.userId, "Booking Confirmed",
    `${priest.name} confirmed "${updated.puja.name}" on ${fmtIST(updated.scheduledAt)}. You can now complete payment and chat with your priest.`,
    { type: "booking_confirmed", bookingId: updated.id });
  res.json(updated);
});

export const rejectBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const { priest, updated } = await transitionBooking(req, "pending", "cancelled");
  void sendPushNotification(updated.userId, "Booking Declined",
    `${priest.name} could not take "${updated.puja.name}" on ${fmtIST(updated.scheduledAt)}. Please choose another time or priest.`,
    { type: "booking_declined", bookingId: updated.id });
  res.json(updated);
});

export const completeBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = await myPriest(req.userId!);
  const booking = await prisma.booking.findFirst({ where: { id: req.params.id, priestId: priest.id } });
  if (booking?.status === "confirmed" && booking.scheduledAt.getTime() > Date.now()) {
    throw new AppError("A booking can be marked completed only after its scheduled time", 400);
  }
  const { updated } = await transitionBooking(req, "confirmed", "completed");
  void sendPushNotification(updated.userId, "Puja Completed",
    `"${updated.puja.name}" with ${priest.name} is complete. We'd love your review!`,
    { type: "booking_completed", bookingId: updated.id });
  res.json(updated);
});

// ── PUSH TOKENS ─────────────────────────────────────────────

export const registerPushToken = catchAsync(async (req: AuthRequest, res: Response) => {
  const { token } = z.object({ token: z.string().min(1).max(300) }).parse(req.body);
  // A device token belongs to whoever is logged in on that device now.
  await prisma.$transaction([
    prisma.user.updateMany({ where: { pushToken: token, id: { not: req.userId! } }, data: { pushToken: null } }),
    prisma.user.update({ where: { id: req.userId! }, data: { pushToken: token } }),
  ]);
  res.json({ success: true });
});

export const clearPushToken = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.user.update({ where: { id: req.userId! }, data: { pushToken: null } });
  res.json({ success: true });
});
