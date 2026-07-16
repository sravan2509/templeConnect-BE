import { Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { bookings, createBooking, priests, priestReviews } from "../data/mockStore";

// TODO(next phase): fully mock — replace with real Priest/Booking/Payment tables

export const listPriests = catchAsync(async (req: AuthRequest, res: Response) => {
  const { specialization, rating, language, availability } = req.query as Record<string, string | undefined>;
  let results = priests;
  if (specialization) results = results.filter((p) => p.specialization.some((s) => s.toLowerCase().includes(specialization.toLowerCase())));
  if (rating) results = results.filter((p) => p.rating >= Number(rating));
  if (language) results = results.filter((p) => p.languages.some((l) => l.toLowerCase() === language.toLowerCase()));
  if (availability) results = results.filter((p) => p.availability.includes(availability));
  res.json(results);
});

export const getPriest = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = priests.find((p) => p.id === req.params.id);
  if (!priest) throw new AppError("Priest not found", 404);
  res.json(priest);
});

export const getPriestReviews = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(priestReviews[req.params.id] ?? []);
});

export const getPriestServices = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = priests.find((p) => p.id === req.params.id);
  if (!priest) throw new AppError("Priest not found", 404);
  res.json(priest.services);
});

export const getPriestAvailability = catchAsync(async (req: AuthRequest, res: Response) => {
  const priest = priests.find((p) => p.id === req.params.id);
  if (!priest) throw new AppError("Priest not found", 404);
  res.json(priest.availability);
});

export const listBookings = catchAsync(async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string | undefined;
  let results = bookings.filter((b) => b.userId === req.userId);
  if (status === "upcoming") results = results.filter((b) => b.status === "pending" || b.status === "confirmed");
  if (status === "past") results = results.filter((b) => b.status === "completed" || b.status === "cancelled");
  res.json(results);
});

const createBookingSchema = z.object({
  priestId: z.string().min(1),
  serviceId: z.string().min(1),
  scheduledAt: z.string().min(1),
});

export const createBookingHandler = catchAsync(async (req: AuthRequest, res: Response) => {
  const { priestId, serviceId, scheduledAt } = createBookingSchema.parse(req.body);
  const booking = createBooking(req.userId!, priestId, serviceId, scheduledAt);
  res.status(201).json(booking);
});

export const getBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const booking = bookings.find((b) => b.id === req.params.id && b.userId === req.userId);
  if (!booking) throw new AppError("Booking not found", 404);
  res.json(booking);
});

export const rescheduleBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const booking = bookings.find((b) => b.id === req.params.id && b.userId === req.userId);
  if (!booking) throw new AppError("Booking not found", 404);
  const { scheduledAt } = z.object({ scheduledAt: z.string().min(1) }).parse(req.body);
  booking.scheduledAt = scheduledAt;
  res.json(booking);
});

export const cancelBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const booking = bookings.find((b) => b.id === req.params.id && b.userId === req.userId);
  if (!booking) throw new AppError("Booking not found", 404);
  booking.status = "cancelled";
  res.json(booking);
});

export const payForBooking = catchAsync(async (req: AuthRequest, res: Response) => {
  const booking = bookings.find((b) => b.id === req.params.id && b.userId === req.userId);
  if (!booking) throw new AppError("Booking not found", 404);
  booking.paid = true;
  booking.status = "confirmed";
  res.json(booking);
});
