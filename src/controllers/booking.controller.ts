import { Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";

export const listPriests = catchAsync(async (_req: AuthRequest, res: Response) => {
  const priests = await prisma.priest.findMany({
    include: { services: true },
  });
  res.json(priests);
});

export const getPriest = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = await prisma.priest.findUnique({
    where: { id: req.params.id },
    include: { services: true, reviews: { take: 10, orderBy: { createdAt: "desc" } } },
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

export const getPriestServices = catchAsync(async (req: AuthRequest, res: Response) => {
  const services = await prisma.priest.findUnique({
    where: { id: req.params.id },
    select: { services: true },
  });
  if (!services) throw new AppError("Priest not found", 404);
  res.json(services.services);
});

export const getPriestAvailability = catchAsync(async (req: AuthRequest, res: Response) => {
  const availability = await prisma.priest.findUnique({
    where: { id: req.params.id },
    select: { availability: true },
  });
  if (!availability) throw new AppError("Priest not found", 404);
  res.json(availability.availability);
});

export const listBookings = catchAsync(async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string | undefined;
  const where: any = { userId: req.userId! };
  if (status === "upcoming") where.status = { in: ["pending", "confirmed"] };
  if (status === "past") where.status = { in: ["completed", "cancelled"] };

  const bookings = await prisma.booking.findMany({
    where,
    include: { priest: { select: { name: true } }, service: { select: { name: true, price: true } } },
    orderBy: { scheduledAt: "desc" },
  });
  res.json(bookings);
});

const createBookingSchema = z.object({
  priestId: z.string().min(1),
  serviceId: z.string().min(1),
  scheduledAt: z.string().min(1),
  notes: z.string().optional(),
});

export const createBookingHandler = catchAsync(async (req: AuthRequest, res: Response) => {
  const { priestId, serviceId, scheduledAt, notes } = createBookingSchema.parse(req.body);

  const service = await prisma.priestService.findUnique({ where: { id: serviceId } });
  if (!service) throw new AppError("Service not found", 404);

  const booking = await prisma.booking.create({
    data: {
      userId: req.userId!,
      priestId,
      serviceId,
      scheduledAt: new Date(scheduledAt),
      amount: service.price,
      notes,
    },
    include: { priest: { select: { name: true } }, service: { select: { name: true } } },
  });
  res.status(201).json(booking);
});

export const getBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const booking = await prisma.booking.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: { priest: { select: { name: true } }, service: { select: { name: true, price: true } } },
  });
  if (!booking) throw new AppError("Booking not found", 404);
  res.json(booking);
});

export const rescheduleBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const { scheduledAt } = z.object({ scheduledAt: z.string().min(1) }).parse(req.body);
  const booking = await prisma.booking.updateMany({
    where: { id: req.params.id, userId: req.userId!, status: { in: ["pending", "confirmed"] } },
    data: { scheduledAt: new Date(scheduledAt) },
  });
  if (booking.count === 0) throw new AppError("Booking not found or cannot be rescheduled", 404);
  const updated = await prisma.booking.findUnique({ where: { id: req.params.id } });
  res.json(updated);
});

export const cancelBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const booking = await prisma.booking.updateMany({
    where: { id: req.params.id, userId: req.userId!, status: { in: ["pending", "confirmed"] } },
    data: { status: "cancelled" },
  });
  if (booking.count === 0) throw new AppError("Booking not found or cannot be cancelled", 404);
  const updated = await prisma.booking.findUnique({ where: { id: req.params.id } });
  res.json(updated);
});

export const payForBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const booking = await prisma.booking.updateMany({
    where: { id: req.params.id, userId: req.userId!, status: "pending" },
    data: { paid: true, status: "confirmed" },
  });
  if (booking.count === 0) throw new AppError("Booking not found or already paid", 404);
  const updated = await prisma.booking.findUnique({ where: { id: req.params.id } });
  res.json(updated);
});
