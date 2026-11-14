import { randomInt } from "crypto";
import { Prisma, ServiceBooking, Temple, TempleService } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { timezoneFor, zonedTimeToUtc } from "../utils/timezone";
import { sendPushNotification } from "./push.service";
import { sendEmail } from "./email.service";
import { createOrder, paymentMode, refundPayment } from "./razorpay.service";

/** Unpaid online bookings hold their slot for this long. */
export const PAYMENT_HOLD_MINUTES = 15;
/** Slots stop accepting bookings this long before they start. */
export const BOOKING_CUTOFF_MINUTES = 30;
const DEFAULT_TZ = "Asia/Kolkata";

export const SERVICE_CATEGORIES = ["seva", "pooja", "pushkaralu", "special"] as const;
export const CATEGORY_LABELS: Record<string, string> = { seva: "Seva", pooja: "Pooja", pushkaralu: "Pushkaraalu", special: "Special Ceremony" };

/** Statuses that occupy a slot. Unpaid holds count only while still within the payment window. */
const ACTIVE_STATUSES = ["confirmed", "completed"];

export interface Policy {
  cancelHoursBefore: number;
  refundPercent: number;
  rescheduleHoursBefore: number;
  maxReschedules: number;
  allowCounterPayment: boolean;
  policyNotes: string | null;
}

/** Festivals (no temple) use a standard policy. */
export const DEFAULT_POLICY: Policy = {
  cancelHoursBefore: 24, refundPercent: 100, rescheduleHoursBefore: 24, maxReschedules: 1, allowCounterPayment: true, policyNotes: null,
};

export function policyOf(temple?: Pick<Temple, keyof Policy> | null): Policy {
  if (!temple) return DEFAULT_POLICY;
  return {
    cancelHoursBefore: temple.cancelHoursBefore, refundPercent: temple.refundPercent,
    rescheduleHoursBefore: temple.rescheduleHoursBefore, maxReschedules: temple.maxReschedules,
    allowCounterPayment: temple.allowCounterPayment, policyNotes: temple.policyNotes,
  };
}

// ── Dates & slots ─────────────────────────────────────────────

export const csv = (v?: string | null) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isValidDate = (d: string) => DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
export const isValidTime = (t: string) => TIME_RE.test(t);

/** YYYY-MM-DD for "now" in a timezone. */
export function todayIn(tz = DEFAULT_TZ, offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

type ServiceWithPlace = TempleService & {
  temple?: Pick<Temple, "lat" | "lon"> | null;
};

export function tzOf(service: ServiceWithPlace): string {
  const t = service.temple;
  return t?.lat != null && t?.lon != null ? timezoneFor(t.lat, t.lon) : DEFAULT_TZ;
}

export function slotInstant(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return zonedTimeToUtc(y, m, d, hh, mm, tz);
}

/** Why a date can't be booked, or null when it can. */
export function dateUnavailableReason(service: ServiceWithPlace, date: string): string | null {
  if (!isValidDate(date)) return "Invalid date";
  const tz = tzOf(service);
  if (date < todayIn(tz)) return "This date has passed";
  if (date > todayIn(tz, service.advanceDays)) return `Bookings open ${service.advanceDays} days in advance`;
  const specific = csv(service.specificDates);
  if (specific.length) return specific.includes(date) ? null : "Not offered on this date";
  if (service.availableFrom && date < service.availableFrom) return `Available from ${service.availableFrom}`;
  if (service.availableTo && date > service.availableTo) return `Available until ${service.availableTo}`;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (!csv(service.daysOfWeek).includes(String(weekday))) return "Not offered on this day of the week";
  return null;
}

/** Participants already holding each slot of a service on a date. */
async function bookedBySlot(serviceId: string, date: string, db: Prisma.TransactionClient = prisma, excludeBookingId?: string) {
  const holdCutoff = new Date(Date.now() - PAYMENT_HOLD_MINUTES * 60000);
  const rows = await db.serviceBooking.findMany({
    where: {
      serviceId, date,
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      OR: [{ status: { in: ACTIVE_STATUSES } }, { status: "pending_payment", createdAt: { gt: holdCutoff } }],
    },
    select: { slotTime: true, participants: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.slotTime, (map.get(r.slotTime) ?? 0) + r.participants);
  return map;
}

export interface SlotInfo {
  time: string;
  capacity: number;
  booked: number;
  remaining: number;
  available: boolean;
  reason?: string;
}

export async function availability(service: ServiceWithPlace, date: string) {
  const reason = !service.active || !service.bookingEnabled ? "Bookings are closed for this service" : dateUnavailableReason(service, date);
  if (reason) return { date, offered: false, reason, slots: [] as SlotInfo[] };
  const tz = tzOf(service);
  const booked = await bookedBySlot(service.id, date);
  const cutoff = Date.now() + BOOKING_CUTOFF_MINUTES * 60000;
  const slots: SlotInfo[] = csv(service.slotTimes).filter(isValidTime).sort().map((time) => {
    const b = booked.get(time) ?? 0;
    const remaining = Math.max(0, service.capacityPerSlot - b);
    const started = slotInstant(date, time, tz).getTime() <= cutoff;
    return {
      time, capacity: service.capacityPerSlot, booked: b, remaining,
      available: !started && remaining > 0,
      ...(started ? { reason: "Closed" } : remaining === 0 ? { reason: "Full" } : {}),
    };
  });
  return { date, offered: true, slots };
}

// ── References ────────────────────────────────────────────────

const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

export async function newReference(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = "TC";
    for (let i = 0; i < 8; i++) code += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
    if (!(await prisma.serviceBooking.findUnique({ where: { reference: code }, select: { id: true } }))) return code;
  }
  throw new AppError("Could not generate a booking reference. Please try again.", 500);
}

// ── Notifications ─────────────────────────────────────────────

export const bookingInclude = {
  service: { select: { id: true, name: true, category: true, durationMins: true, materials: true, participation: true, timings: true } },
  temple: { select: { id: true, placeId: true, name: true, city: true, state: true, address: true, phone: true, lat: true, lon: true } },
  festival: { select: { id: true, name: true, river: true } },
  transactions: { orderBy: { createdAt: "asc" as const } },
} as const;

export type BookingFull = Prisma.ServiceBookingGetPayload<{ include: typeof bookingInclude }>;

export function placeName(b: { temple?: { name: string } | null; festival?: { name: string } | null }) {
  return b.temple?.name ?? b.festival?.name ?? "the temple";
}

export function formatSlot(date: string, time: string) {
  const d = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const [h, m] = time.split(":").map(Number);
  return `${d}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Push + in-app notification (and email when we have an address). Never throws. */
export async function notifyBooking(b: BookingFull, kind: string, title: string, body: string, opts: { wait?: boolean } = {}) {
  const data = { type: `booking_${kind}`, bookingId: b.id, reference: b.reference, screen: "ServiceBookingDetail" };
  // Requests don't wait for push delivery; background jobs do, so nothing is lost if the process exits.
  const push = b.userId ? sendPushNotification(b.userId, title, body, data) : Promise.resolve(false);
  if (opts.wait) await push;
  const email = b.email ?? (b.userId ? (await prisma.user.findUnique({ where: { id: b.userId }, select: { email: true } }))?.email : null);
  if (email) {
    void sendEmail(email, `${title} — ${b.reference}`, `${body}\n\nBooking reference: ${b.reference}\n${b.service.name} at ${placeName(b)}\n${formatSlot(b.date, b.slotTime)}\n\nTemple Connect`)
      .catch((err) => console.error(`[EMAIL] ${err.message}`));
  }
}

// ── Create ────────────────────────────────────────────────────

export interface CreateBookingInput {
  serviceId: string;
  date: string;
  slotTime: string;
  participants: number;
  participation: "online" | "offline";
  paymentMode: "online" | "counter";
  devoteeName: string;
  phone?: string;
  email?: string;
  gotra?: string;
  nakshatra?: string;
  notes?: string;
  /** For donation-type services; must be at least the listed price. */
  amount?: number;
}

export async function loadService(serviceId: string) {
  const service = await prisma.templeService.findUnique({
    where: { id: serviceId },
    include: { temple: true, festival: { select: { id: true, name: true, active: true } } },
  });
  if (!service) throw new AppError("Service not found", 404);
  return service;
}

export async function createServiceBooking(
  input: CreateBookingInput,
  ctx: { userId?: string; staffId?: string; source: "app" | "walk_in" }
): Promise<{ booking: BookingFull; payment: null | { mode: "razorpay" | "simulated"; orderId?: string; amount: number } }> {
  const service = await loadService(input.serviceId);
  if (!service.active || (ctx.source === "app" && !service.bookingEnabled)) throw new AppError("Bookings are closed for this service");
  if (service.festival && !service.festival.active) throw new AppError("This festival is not accepting bookings");
  if (!service.templeId && !service.festivalId) throw new AppError("This service is not linked to a temple", 500);

  const allowed = service.participation === "both" ? ["online", "offline"] : [service.participation];
  if (!allowed.includes(input.participation)) {
    throw new AppError(service.participation === "online" ? "This service is performed online only" : "This service requires attending in person");
  }

  const policy = policyOf(service.temple);
  if (input.paymentMode === "counter" && ctx.source === "app" && !policy.allowCounterPayment) {
    throw new AppError("This temple accepts online payment only");
  }

  let amount = service.price;
  if (service.priceType === "donation" && input.amount != null) {
    if (input.amount < service.price) throw new AppError(`The minimum donation is ₹${service.price}`);
    amount = Math.round(input.amount * 100) / 100;
  }
  const free = amount <= 0;

  if (!free && input.paymentMode === "online" && ctx.source === "app" && paymentMode() === "unavailable") {
    throw new AppError("Online payment is not available right now. Choose 'Pay at temple' or try later.", 503);
  }

  // Staff may book walk-ins for slots that have just started; devotees must respect the cutoff.
  const tz = tzOf(service);
  const dateReason = dateUnavailableReason(service, input.date);
  if (dateReason && !(ctx.source === "walk_in" && input.date === todayIn(tz))) throw new AppError(dateReason);
  if (!csv(service.slotTimes).includes(input.slotTime)) throw new AppError("Please choose one of the listed time slots");
  const scheduledAt = slotInstant(input.date, input.slotTime, tz);
  if (ctx.source === "app" && scheduledAt.getTime() <= Date.now() + BOOKING_CUTOFF_MINUTES * 60000) {
    throw new AppError("This slot is closed for booking. Please choose a later time.");
  }

  const reference = await newReference();
  const online = !free && input.paymentMode === "online";

  const booking = await prisma.$transaction(async (tx) => {
    const booked = (await bookedBySlot(service.id, input.date, tx)).get(input.slotTime) ?? 0;
    if (booked + input.participants > service.capacityPerSlot) {
      const left = Math.max(0, service.capacityPerSlot - booked);
      throw new AppError(left ? `Only ${left} place(s) left in this slot` : "This slot is fully booked. Please choose another time.", 409);
    }
    return tx.serviceBooking.create({
      data: {
        reference, serviceId: service.id, templeId: service.templeId, festivalId: service.festivalId,
        userId: ctx.userId ?? null, createdById: ctx.staffId ?? null, source: ctx.source,
        devoteeName: input.devoteeName, phone: input.phone, email: input.email, gotra: input.gotra, nakshatra: input.nakshatra,
        notes: input.notes, participants: input.participants, date: input.date, slotTime: input.slotTime, scheduledAt,
        participation: input.participation, paymentMode: free ? "counter" : input.paymentMode, amount,
        paymentStatus: free ? "not_required" : "pending",
        status: online ? "pending_payment" : "confirmed",
      },
      include: bookingInclude,
    });
  });

  if (!online) {
    if (ctx.source === "app") {
      await notifyBooking(booking, "confirmed", "Booking Confirmed 🙏",
        `${booking.service.name} at ${placeName(booking)} on ${formatSlot(booking.date, booking.slotTime)}. Ref ${booking.reference}.` +
        (free ? "" : ` Please pay ₹${amount} at the temple counter.`));
    }
    return { booking, payment: null };
  }

  const mode = paymentMode() as "razorpay" | "simulated";
  if (mode === "simulated") return { booking, payment: { mode, amount } };
  try {
    const order = await createOrder(amount, booking.reference, { bookingId: booking.id, reference: booking.reference });
    const updated = await prisma.serviceBooking.update({ where: { id: booking.id }, data: { razorpayOrderId: order.id }, include: bookingInclude });
    return { booking: updated, payment: { mode, orderId: order.id, amount } };
  } catch (err) {
    // Release the slot if the gateway is down.
    await prisma.serviceBooking.update({ where: { id: booking.id }, data: { status: "expired" } });
    throw err;
  }
}

// ── Payment ───────────────────────────────────────────────────

export async function recordPayment(
  bookingId: string,
  p: { method: string; gatewayRef?: string; recordedById?: string; note?: string; razorpayPaymentId?: string }
): Promise<BookingFull> {
  const existing = await prisma.serviceBooking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!existing) throw new AppError("Booking not found", 404);
  if (existing.paymentStatus === "paid") return existing; // idempotent (checkout callback + webhook)
  if (["cancelled", "expired"].includes(existing.status) && p.method !== "razorpay") throw new AppError("This booking is no longer active");
  if (existing.paymentStatus === "not_required") throw new AppError("This booking is free; no payment is needed");

  const booking = await prisma.$transaction(async (tx) => {
    await tx.paymentTransaction.create({
      data: { bookingId, type: "payment", method: p.method, amount: existing.amount, status: "success", gatewayRef: p.gatewayRef, recordedById: p.recordedById, note: p.note },
    });
    return tx.serviceBooking.update({
      where: { id: bookingId },
      // A late gateway payment for an expired hold still confirms the booking: the devotee has paid.
      data: {
        paymentStatus: "paid", razorpayPaymentId: p.razorpayPaymentId ?? existing.razorpayPaymentId,
        status: ["pending_payment", "expired"].includes(existing.status) ? "confirmed" : existing.status,
      },
      include: bookingInclude,
    });
  });

  if (existing.status === "pending_payment" || existing.status === "expired") {
    await notifyBooking(booking, "confirmed", "Booking Confirmed 🙏",
      `Payment of ₹${booking.amount} received. ${booking.service.name} at ${placeName(booking)} on ${formatSlot(booking.date, booking.slotTime)}. Ref ${booking.reference}.`);
  } else {
    await notifyBooking(booking, "paid", "Payment Received", `₹${booking.amount} received for booking ${booking.reference}. Thank you.`);
  }
  return booking;
}

// ── Cancel & reschedule ───────────────────────────────────────

const hoursUntil = (d: Date) => (d.getTime() - Date.now()) / 3600000;

export async function loadBooking(id: string) {
  const booking = await prisma.serviceBooking.findUnique({ where: { id }, include: { ...bookingInclude, temple: true } });
  if (!booking) throw new AppError("Booking not found", 404);
  return booking;
}

/** What cancelling now would mean for the devotee, shown before they confirm. */
export function cancellationQuote(b: ServiceBooking & { temple: Temple | null }, by: "user" | "staff") {
  const policy = policyOf(b.temple);
  if (!["confirmed", "pending_payment"].includes(b.status)) return { allowed: false, reason: "This booking can no longer be cancelled", refund: 0, policy };
  if (by === "user" && b.status === "confirmed" && hoursUntil(b.scheduledAt) < policy.cancelHoursBefore) {
    return { allowed: false, reason: `Cancellation is allowed up to ${policy.cancelHoursBefore} hours before the booking`, refund: 0, policy };
  }
  const paid = b.paymentStatus === "paid";
  // When the temple cancels, the devotee gets a full refund.
  const percent = by === "staff" ? 100 : policy.refundPercent;
  return { allowed: true, refund: paid ? Math.round(b.amount * percent) / 100 : 0, refundPercent: paid ? percent : 0, policy };
}

export async function cancelServiceBooking(
  id: string,
  ctx: { by: "user" | "staff"; actorId: string; reason?: string; refundPercent?: number }
): Promise<BookingFull> {
  const b = await loadBooking(id);
  const quote = cancellationQuote(b, ctx.by);
  if (!quote.allowed) throw new AppError(quote.reason!);
  let refund = quote.refund;
  if (ctx.by === "staff" && ctx.refundPercent != null && b.paymentStatus === "paid") refund = Math.round(b.amount * ctx.refundPercent) / 100;

  let refundTxn: Prisma.PaymentTransactionCreateWithoutBookingInput | null = null;
  let paymentStatus = b.paymentStatus;
  if (refund > 0) {
    if (b.razorpayPaymentId && !b.razorpayPaymentId.startsWith("SIM-")) {
      const r = await refundPayment(b.razorpayPaymentId, refund, { reference: b.reference });
      refundTxn = { type: "refund", method: "razorpay", amount: refund, status: r.status === "processed" ? "success" : "pending", gatewayRef: r.id, recordedById: ctx.actorId };
    } else if (b.razorpayPaymentId) {
      refundTxn = { type: "refund", method: "simulated", amount: refund, status: "success", gatewayRef: `SIMREF-${b.reference}`, recordedById: ctx.actorId };
    } else {
      // Paid at the counter: staff hand the money back; devotee-initiated refunds are collected at the counter.
      refundTxn = { type: "refund", method: "counter", amount: refund, status: ctx.by === "staff" ? "success" : "pending", recordedById: ctx.actorId, note: ctx.by === "staff" ? "Refunded at counter" : "Collect refund at the temple counter" };
    }
    paymentStatus = refund >= b.amount ? "refunded" : "partially_refunded";
  }

  const updated = await prisma.serviceBooking.update({
    where: { id },
    data: {
      status: "cancelled", cancelledAt: new Date(), cancelledBy: ctx.by, cancelReason: ctx.reason, refundAmount: refund, paymentStatus,
      ...(refundTxn ? { transactions: { create: refundTxn } } : {}),
    },
    include: bookingInclude,
  });

  const refundText = refund > 0 ? ` A refund of ₹${refund} ${refundTxn?.method === "counter" && ctx.by === "user" ? "can be collected at the temple counter" : "has been initiated"}.` : "";
  await notifyBooking(updated, "cancelled", "Booking Cancelled",
    `${updated.service.name} on ${formatSlot(updated.date, updated.slotTime)} (Ref ${updated.reference}) was cancelled${ctx.by === "staff" ? " by the temple" : ""}.${ctx.reason && ctx.by === "staff" ? ` Reason: ${ctx.reason}.` : ""}${refundText}`);
  return updated;
}

export async function rescheduleServiceBooking(
  id: string,
  ctx: { by: "user" | "staff"; date: string; slotTime: string }
): Promise<BookingFull> {
  const b = await loadBooking(id);
  if (b.status !== "confirmed") throw new AppError("Only confirmed bookings can be rescheduled");
  const policy = policyOf(b.temple);
  if (ctx.by === "user") {
    if (hoursUntil(b.scheduledAt) < policy.rescheduleHoursBefore) throw new AppError(`Rescheduling is allowed up to ${policy.rescheduleHoursBefore} hours before the booking`);
    if (b.rescheduleCount >= policy.maxReschedules) {
      throw new AppError(policy.maxReschedules === 0 ? "This temple does not allow rescheduling" : `A booking can be rescheduled at most ${policy.maxReschedules} time(s)`);
    }
  }
  if (b.date === ctx.date && b.slotTime === ctx.slotTime) throw new AppError("Please choose a different date or time");

  const service = await loadService(b.serviceId);
  const reason = dateUnavailableReason(service, ctx.date);
  if (reason) throw new AppError(reason);
  if (!csv(service.slotTimes).includes(ctx.slotTime)) throw new AppError("Please choose one of the listed time slots");
  const scheduledAt = slotInstant(ctx.date, ctx.slotTime, tzOf(service));
  if (scheduledAt.getTime() <= Date.now() + BOOKING_CUTOFF_MINUTES * 60000) throw new AppError("That slot is closed. Please choose a later time.");

  const before = formatSlot(b.date, b.slotTime);
  const updated = await prisma.$transaction(async (tx) => {
    const booked = (await bookedBySlot(service.id, ctx.date, tx, b.id)).get(ctx.slotTime) ?? 0;
    if (booked + b.participants > service.capacityPerSlot) throw new AppError("That slot doesn't have enough places left", 409);
    return tx.serviceBooking.update({
      where: { id },
      data: { date: ctx.date, slotTime: ctx.slotTime, scheduledAt, reminderSentAt: null, rescheduleCount: { increment: ctx.by === "user" ? 1 : 0 } },
      include: bookingInclude,
    });
  });
  await notifyBooking(updated, "rescheduled", "Booking Rescheduled",
    `${updated.service.name} (Ref ${updated.reference}) moved from ${before} to ${formatSlot(updated.date, updated.slotTime)}${ctx.by === "staff" ? " by the temple" : ""}.`);
  return updated;
}

/** Shape returned to devotees and staff (adds computed policy hints). */
export function presentBooking(b: BookingFull & { temple?: any }, by: "user" | "staff" = "user") {
  const policy = policyOf(b.temple && "cancelHoursBefore" in b.temple ? b.temple : null);
  const hours = hoursUntil(b.scheduledAt);
  const { temple, ...rest } = b as any;
  const t = temple ? { id: temple.id, placeId: temple.placeId, name: temple.name, city: temple.city, state: temple.state, address: temple.address, phone: temple.phone, lat: temple.lat, lon: temple.lon } : null;
  return {
    ...rest,
    temple: t,
    canCancel: ["confirmed", "pending_payment"].includes(b.status) && (by === "staff" || b.status === "pending_payment" || hours >= policy.cancelHoursBefore),
    canReschedule: b.status === "confirmed" && (by === "staff" || (hours >= policy.rescheduleHoursBefore && b.rescheduleCount < policy.maxReschedules)),
    policy,
  };
}
