import { Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { ScopedRequest, scopeWhere } from "../middleware/templeScope";
import { logAudit } from "../services/audit.service";
import { communityUserIds, notifyAudience, resolveAudience } from "../services/audience.service";
import { notifyRecipients } from "../services/push.service";
import { storeImage } from "../services/storage.service";
import { clearTempleCache } from "../services/temple.service";
import {
  availability, bookingInclude, cancelServiceBooking, cancellationQuote, CATEGORY_LABELS, createServiceBooking, csv,
  formatSlot, isValidDate, loadBooking, loadService, notifyBooking, presentBooking, recordPayment, rescheduleServiceBooking,
  SERVICE_CATEGORIES, todayIn,
} from "../services/serviceBooking.service";

const actor = (req: ScopedRequest) => ({ userId: req.userId, role: req.userRole });
const scopeOf = (req: ScopedRequest) => req.scope!;
const auditScope = (req: ScopedRequest) => ({ templeId: req.scope!.templeId ?? null, festivalId: req.scope!.festivalId ?? null });

const dateStr = z.string().refine(isValidDate, "Use a valid date (YYYY-MM-DD)");
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time like 06:30");
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const imageUrl = z.string().trim().max(500).refine((v) => /^https?:\/\//.test(v) || v.startsWith("/uploads/"), "Invalid image URL");

// ── Context ───────────────────────────────────────────────────

const POLICY_FIELDS = {
  cancelHoursBefore: true, refundPercent: true, rescheduleHoursBefore: true, maxReschedules: true, allowCounterPayment: true, policyNotes: true,
} as const;

export const portalMe = catchAsync(async (req: ScopedRequest, res: Response) => {
  const scope = scopeOf(req);
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, name: true, email: true, role: true } });
  if (scope.templeId) {
    const temple = await prisma.temple.findUnique({
      where: { id: scope.templeId },
      select: {
        id: true, placeId: true, name: true, deityName: true, address: true, city: true, state: true, lat: true, lon: true,
        phone: true, website: true, contactDetails: true, openingHours: true, templeHistory: true, significance: true, imageUrl: true,
        ...POLICY_FIELDS, _count: { select: { followers: true } },
      },
    });
    return res.json({ kind: "temple", user, temple });
  }
  const festival = await prisma.festival.findUnique({ where: { id: scope.festivalId! }, include: { ghats: { orderBy: { name: "asc" } } } });
  res.json({ kind: "festival", user, festival });
});

const templeProfileSchema = z.object({
  phone: optText(30), website: optText(300), contactDetails: optText(500), openingHours: optText(500),
  templeHistory: optText(5000), significance: optText(2000), address: optText(300), deityName: optText(100),
  imageUrl: imageUrl.optional().nullable(),
}).strict();

export const updateTempleProfile = catchAsync(async (req: ScopedRequest, res: Response) => {
  const templeId = scopeOf(req).templeId!;
  const data = templeProfileSchema.parse(req.body);
  const before = await prisma.temple.findUniqueOrThrow({ where: { id: templeId } });
  const after = await prisma.temple.update({ where: { id: templeId }, data });
  clearTempleCache();
  await logAudit(actor(req), { templeId, action: "temple.update", entityType: "temple", entityId: templeId, summary: "Updated temple details", before, after });
  res.json(after);
});

const policySchema = z.object({
  cancelHoursBefore: z.number().int().min(0).max(720),
  refundPercent: z.number().int().min(0).max(100),
  rescheduleHoursBefore: z.number().int().min(0).max(720),
  maxReschedules: z.number().int().min(0).max(10),
  allowCounterPayment: z.boolean(),
  policyNotes: optText(1000),
}).partial().strict();

export const updatePolicy = catchAsync(async (req: ScopedRequest, res: Response) => {
  const templeId = scopeOf(req).templeId!;
  const data = policySchema.parse(req.body);
  const before = await prisma.temple.findUniqueOrThrow({ where: { id: templeId }, select: POLICY_FIELDS });
  const after = await prisma.temple.update({ where: { id: templeId }, data, select: POLICY_FIELDS });
  await logAudit(actor(req), { templeId, action: "policy.update", entityType: "temple", entityId: templeId, summary: "Updated booking & cancellation policy", before, after });
  res.json(after);
});

export const uploadImage = catchAsync(async (req: ScopedRequest, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new AppError("Choose an image to upload");
  const folder = (["events", "temples", "services", "festivals"] as const).find((f) => f === req.query.folder) ?? "events";
  res.status(201).json({ url: await storeImage(file.buffer, folder) });
});

// ── Dashboard ─────────────────────────────────────────────────

export const portalDashboard = catchAsync(async (req: ScopedRequest, res: Response) => {
  const scope = scopeOf(req);
  const where = scopeWhere(scope);
  const now = new Date();
  const today = todayIn();
  const monthStart = `${today.slice(0, 7)}-01`;
  const live = { status: { in: ["confirmed", "completed"] } };

  const [total, todayCount, upcoming, unpaidCounter, cancelled, byCategoryRaw, payments, refunds, monthPayments, followers, upcomingEvents, recent] = await Promise.all([
    prisma.serviceBooking.count({ where: { ...where, ...live } }),
    prisma.serviceBooking.count({ where: { ...where, ...live, date: today } }),
    prisma.serviceBooking.count({ where: { ...where, status: "confirmed", scheduledAt: { gt: now } } }),
    prisma.serviceBooking.count({ where: { ...where, status: "confirmed", paymentStatus: "pending" } }),
    prisma.serviceBooking.count({ where: { ...where, status: "cancelled" } }),
    prisma.serviceBooking.findMany({ where: { ...where, ...live }, select: { service: { select: { category: true } } } }),
    prisma.paymentTransaction.groupBy({ by: ["method"], where: { type: "payment", status: "success", booking: where }, _sum: { amount: true }, _count: true }),
    prisma.paymentTransaction.aggregate({ where: { type: "refund", status: "success", booking: where }, _sum: { amount: true } }),
    prisma.paymentTransaction.aggregate({ where: { type: "payment", status: "success", booking: where, createdAt: { gte: new Date(`${monthStart}T00:00:00+05:30`) } }, _sum: { amount: true } }),
    scope.templeId ? prisma.templeFollow.count({ where: { templeId: scope.templeId } }) : Promise.resolve(0),
    scope.templeId
      ? prisma.templeEvent.findMany({
          where: { templeId: scope.templeId, cancelled: false, OR: [{ date: { gte: today } }, { endDate: { gte: today } }] },
          orderBy: { date: "asc" }, take: 5,
          select: { id: true, name: true, date: true, time: true, posterUrl: true, published: true, _count: { select: { responses: true } } },
        })
      : Promise.resolve([]),
    prisma.serviceBooking.findMany({ where, orderBy: { createdAt: "desc" }, take: 6, include: { service: { select: { name: true, category: true } } } }),
  ]);

  const byCategory: Record<string, number> = Object.fromEntries(SERVICE_CATEGORIES.map((c) => [c, 0]));
  for (const b of byCategoryRaw) byCategory[b.service.category] = (byCategory[b.service.category] ?? 0) + 1;
  const collected = payments.reduce((s, p) => s + (p._sum.amount ?? 0), 0);
  const online = payments.filter((p) => ["razorpay", "simulated"].includes(p.method)).reduce((s, p) => s + (p._sum.amount ?? 0), 0);
  const upcomingEventCount = scope.templeId
    ? await prisma.templeEvent.count({ where: { templeId: scope.templeId, cancelled: false, published: true, date: { gte: today } } })
    : 0;

  res.json({
    bookings: { total, today: todayCount, upcoming, unpaidCounter, cancelled, byCategory },
    payments: { collected, online, counter: collected - online, refunded: refunds._sum.amount ?? 0, net: collected - (refunds._sum.amount ?? 0), thisMonth: monthPayments._sum.amount ?? 0 },
    events: { upcoming: upcomingEventCount, next: upcomingEvents },
    followers,
    recentBookings: recent,
  });
});

// ── Services (Sevas / Poojas / Pushkaraalu / special) ─────────

const serviceSchema = z.object({
  category: z.enum(SERVICE_CATEGORIES),
  name: z.string().trim().min(1, "Name is required").max(200),
  description: optText(2000),
  price: z.number().min(0).max(1000000),
  priceType: z.enum(["fixed", "donation"]).default("fixed"),
  durationMins: z.number().int().min(1).max(1440).optional().nullable(),
  timings: optText(200),
  materials: optText(1000),
  participation: z.enum(["offline", "online", "both"]),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day").max(7),
  slotTimes: z.array(timeStr).min(1, "Add at least one time slot").max(48),
  capacityPerSlot: z.number().int().min(1).max(100000),
  availableFrom: dateStr.optional().nullable(),
  availableTo: dateStr.optional().nullable(),
  specificDates: z.array(dateStr).max(120).optional().nullable(),
  advanceDays: z.number().int().min(1).max(730).default(60),
  bookingEnabled: z.boolean().default(true),
  active: z.boolean().default(true),
  imageUrl: imageUrl.optional().nullable(),
  ghatId: z.string().max(64).optional().nullable(),
  /** Tell followers about this change (default true). */
  notify: z.boolean().optional(),
}).strict();

function toServiceData(d: Partial<z.infer<typeof serviceSchema>>) {
  const { notify: _n, daysOfWeek, slotTimes, specificDates, ...rest } = d;
  return {
    ...rest,
    ...(daysOfWeek ? { daysOfWeek: [...new Set(daysOfWeek)].sort().join(",") } : {}),
    ...(slotTimes ? { slotTimes: [...new Set(slotTimes)].sort().join(",") } : {}),
    ...(specificDates !== undefined ? { specificDates: specificDates?.length ? [...new Set(specificDates)].sort().join(",") : null } : {}),
  };
}

function validateWindow(d: { availableFrom?: string | null; availableTo?: string | null }) {
  if (d.availableFrom && d.availableTo && d.availableFrom > d.availableTo) throw new AppError("'Available from' must be before 'available to'");
}

async function checkGhat(req: ScopedRequest, ghatId?: string | null) {
  if (!ghatId) return;
  const ghat = await prisma.festivalGhat.findUnique({ where: { id: ghatId }, select: { festivalId: true } });
  if (!ghat || ghat.festivalId !== scopeOf(req).festivalId) throw new AppError("Ghat not found for this festival", 404);
}

function presentService(s: any) {
  return { ...s, daysOfWeek: csv(s.daysOfWeek).map(Number), slotTimes: csv(s.slotTimes), specificDates: csv(s.specificDates), categoryLabel: CATEGORY_LABELS[s.category] ?? s.category };
}

const NOTIFY_FIELDS = ["name", "price", "timings", "slotTimes", "daysOfWeek", "bookingEnabled", "active", "availableFrom", "availableTo", "specificDates", "description", "participation"];

async function announceServiceChange(req: ScopedRequest, service: any, what: "new" | "updated" | "removed", changed: string[] = []) {
  const scope = scopeOf(req);
  const label = CATEGORY_LABELS[service.category] ?? "Seva";
  if (scope.templeId) {
    const temple = await prisma.temple.findUnique({ where: { id: scope.templeId }, select: { name: true, city: true, state: true, lat: true, lon: true } });
    if (!temple) return;
    const title = what === "new" ? `New ${label} at ${temple.name}` : what === "removed" ? `${label} no longer offered` : `${label} updated: ${service.name}`;
    const detail = what === "new" ? `${service.name}${service.price ? ` · ₹${service.price}` : ""}. Book now in the app.`
      : what === "removed" ? `${service.name} at ${temple.name} has been discontinued.`
      : `${temple.name} updated ${changed.map((c) => c.replace(/([A-Z])/g, " $1").toLowerCase()).join(", ")}.${service.bookingEnabled && service.active ? " Tap to view." : " Bookings are currently closed."}`;
    void notifyAudience({ templeId: scope.templeId, kind: "seva", place: temple, excludeUserIds: [req.userId!] }, title, detail, { serviceId: service.id, screen: "TempleServices" });
  } else if (scope.festivalId) {
    // Festival poojas: tell devotees whose areas cover the ghat (or festival-wide when no ghat).
    const ghat = service.ghatId ? await prisma.festivalGhat.findUnique({ where: { id: service.ghatId } }) : null;
    const festival = await prisma.festival.findUnique({ where: { id: scope.festivalId }, select: { name: true } });
    const ids = ghat ? await communityUserIds(ghat) : [];
    if (!ids.length || !festival) return;
    void notifyRecipients(ids.filter((i) => i !== req.userId).map((userId) => ({ userId, type: "festival_update" })),
      `${festival.name}: ${what === "new" ? "new pooja" : "pooja updated"}`, `${service.name}${ghat ? ` at ${ghat.name}` : ""}. Tap to book.`,
      { festivalId: scope.festivalId, serviceId: service.id, screen: "Festival" });
  }
}

export const listServices = catchAsync(async (req: ScopedRequest, res: Response) => {
  const services = await prisma.templeService.findMany({
    where: scopeWhere(scopeOf(req)),
    orderBy: [{ active: "desc" }, { category: "asc" }, { name: "asc" }],
    include: { ghat: { select: { id: true, name: true } }, _count: { select: { bookings: { where: { status: { in: ["confirmed", "completed"] } } } } } },
  });
  res.json(services.map(presentService));
});

export const createService = catchAsync(async (req: ScopedRequest, res: Response) => {
  const d = serviceSchema.parse(req.body);
  validateWindow(d);
  await checkGhat(req, d.ghatId);
  if (scopeOf(req).templeId && d.ghatId) throw new AppError("Ghats are only used for festivals");
  const created = await prisma.templeService.create({ data: { ...toServiceData(d), ...scopeWhere(scopeOf(req)) } as any });
  await logAudit(actor(req), { ...auditScope(req), action: "service.create", entityType: "service", entityId: created.id, summary: `Added ${CATEGORY_LABELS[created.category]} "${created.name}"`, after: created });
  if (d.notify !== false && created.active) await announceServiceChange(req, created, "new");
  res.status(201).json(presentService(created));
});

async function serviceInScope(req: ScopedRequest) {
  const s = await prisma.templeService.findUnique({ where: { id: req.params.id } });
  const scope = scopeOf(req);
  if (!s || (scope.templeId ? s.templeId !== scope.templeId : s.festivalId !== scope.festivalId)) throw new AppError("Service not found", 404);
  return s;
}

export const updateService = catchAsync(async (req: ScopedRequest, res: Response) => {
  const before = await serviceInScope(req);
  const d = serviceSchema.partial().strict().parse(req.body);
  const data = toServiceData(d);
  validateWindow({ availableFrom: d.availableFrom !== undefined ? d.availableFrom : before.availableFrom, availableTo: d.availableTo !== undefined ? d.availableTo : before.availableTo });
  await checkGhat(req, d.ghatId);
  const after = await prisma.templeService.update({ where: { id: before.id }, data: data as any });
  const changed = NOTIFY_FIELDS.filter((f) => (before as any)[f] !== (after as any)[f]);
  await logAudit(actor(req), { ...auditScope(req), action: "service.update", entityType: "service", entityId: after.id, summary: `Updated "${after.name}"`, before, after });
  if (d.notify !== false && changed.length) await announceServiceChange(req, after, "updated", changed);
  res.json(presentService(after));
});

export const deleteService = catchAsync(async (req: ScopedRequest, res: Response) => {
  const s = await serviceInScope(req);
  const hasBookings = await prisma.serviceBooking.count({ where: { serviceId: s.id } });
  if (hasBookings) {
    // Keep history intact: retire instead of deleting.
    await prisma.templeService.update({ where: { id: s.id }, data: { active: false, bookingEnabled: false } });
  } else {
    await prisma.templeService.delete({ where: { id: s.id } });
  }
  await logAudit(actor(req), { ...auditScope(req), action: hasBookings ? "service.retire" : "service.delete", entityType: "service", entityId: s.id, summary: `${hasBookings ? "Retired" : "Deleted"} "${s.name}"`, before: s });
  if (s.active && req.query.notify !== "false") await announceServiceChange(req, s, "removed");
  res.json({ deleted: !hasBookings, retired: !!hasBookings });
});

export const serviceAvailability = catchAsync(async (req: ScopedRequest, res: Response) => {
  await serviceInScope(req);
  const service = await loadService(req.params.id);
  const date = String(req.query.date ?? todayIn());
  res.json(await availability({ ...service, bookingEnabled: true }, date));
});

// ── Events ────────────────────────────────────────────────────

const eventSchema = z.object({
  name: z.string().trim().min(1, "Event name is required").max(200),
  description: optText(5000),
  date: dateStr,
  time: optText(20),
  endDate: dateStr.optional().nullable(),
  endTime: optText(20),
  venue: optText(300),
  city: optText(100),
  state: optText(100),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lon: z.number().min(-180).max(180).optional().nullable(),
  posterUrl: imageUrl.optional().nullable(),
  images: z.array(imageUrl).max(10).optional(),
  contactName: optText(100),
  contactPhone: optText(30),
  contactEmail: z.string().trim().email().max(200).optional().nullable().or(z.literal("").transform(() => null)),
  registrationType: z.enum(["none", "interest", "registration"]).default("interest"),
  registrationInfo: optText(2000),
  capacity: z.number().int().min(1).max(1000000).optional().nullable(),
  published: z.boolean().default(true),
  notify: z.boolean().optional(),
}).strict();

function presentEvent(e: any) {
  let images: string[] = [];
  try { images = e.images ? JSON.parse(e.images) : []; } catch {}
  return { ...e, images };
}

async function eventInScope(req: ScopedRequest) {
  const e = await prisma.templeEvent.findUnique({ where: { id: req.params.id } });
  if (!e || e.templeId !== scopeOf(req).templeId) throw new AppError("Event not found", 404);
  return e;
}

async function announceEvent(req: ScopedRequest, event: any, what: "new" | "updated" | "cancelled") {
  const temple = await prisma.temple.findUnique({ where: { id: event.templeId }, select: { name: true, city: true, state: true, lat: true, lon: true } });
  if (!temple) return { targeted: 0, notified: 0 };
  const place = { city: event.city ?? temple.city, state: event.state ?? temple.state, lat: event.lat ?? temple.lat, lon: event.lon ?? temple.lon };
  const when = formatSlot(event.date, /^\d{2}:\d{2}$/.test(event.time ?? "") ? event.time : "00:00").replace(/, 12:00 AM$/, "");
  const title = what === "new" ? `🎉 ${event.name}` : what === "cancelled" ? `Event cancelled: ${event.name}` : `Event updated: ${event.name}`;
  const body = what === "cancelled" ? `${temple.name} has cancelled this event.` : `${temple.name} · ${when}${event.venue ? ` · ${event.venue}` : ""}. Tap for details.`;
  return notifyAudience({ templeId: event.templeId, kind: "event", place, excludeUserIds: [req.userId!] }, title, body, { eventId: event.id, screen: "EventDetail" });
}

export const listEvents = catchAsync(async (req: ScopedRequest, res: Response) => {
  const past = req.query.past === "true";
  const today = todayIn();
  const events = await prisma.templeEvent.findMany({
    where: { templeId: scopeOf(req).templeId, ...(past ? { date: { lt: today } } : { OR: [{ date: { gte: today } }, { endDate: { gte: today } }] }) },
    orderBy: { date: past ? "desc" : "asc" },
    take: 200,
    include: { _count: { select: { responses: true } } },
  });
  res.json(events.map(presentEvent));
});

const EVENT_NOTIFY_FIELDS = ["name", "date", "time", "endDate", "endTime", "venue", "description", "registrationType", "capacity"];

export const createEvent = catchAsync(async (req: ScopedRequest, res: Response) => {
  const d = eventSchema.parse(req.body);
  if (d.endDate && d.endDate < d.date) throw new AppError("End date must be on or after the start date");
  if (d.date < todayIn()) throw new AppError("The event date has already passed");
  const { notify, images, ...rest } = d;
  const event = await prisma.templeEvent.create({
    data: { ...rest, images: images?.length ? JSON.stringify(images) : null, templeId: scopeOf(req).templeId!, createdById: req.userId },
  });
  clearTempleCache();
  await logAudit(actor(req), { templeId: event.templeId, action: "event.create", entityType: "event", entityId: event.id, summary: `${event.published ? "Published" : "Drafted"} event "${event.name}"`, after: event });
  const reach = event.published && notify !== false ? await announceEvent(req, event, "new") : null;
  res.status(201).json({ ...presentEvent(event), notified: reach?.notified ?? 0 });
});

export const updateEvent = catchAsync(async (req: ScopedRequest, res: Response) => {
  const before = await eventInScope(req);
  const d = eventSchema.partial().strict().parse(req.body);
  const { notify, images, ...rest } = d;
  const endDate = d.endDate !== undefined ? d.endDate : before.endDate;
  if (endDate && endDate < (d.date ?? before.date)) throw new AppError("End date must be on or after the start date");
  const after = await prisma.templeEvent.update({
    where: { id: before.id },
    data: { ...rest, ...(images !== undefined ? { images: images.length ? JSON.stringify(images) : null } : {}) },
  });
  clearTempleCache();
  await logAudit(actor(req), { templeId: after.templeId, action: "event.update", entityType: "event", entityId: after.id, summary: `Updated event "${after.name}"`, before, after });
  let notified = 0;
  if (after.published && notify !== false && !after.cancelled) {
    const firstPublish = !before.published;
    const changed = EVENT_NOTIFY_FIELDS.some((f) => (before as any)[f] !== (after as any)[f]);
    if (firstPublish || changed) notified = (await announceEvent(req, after, firstPublish ? "new" : "updated")).notified;
  }
  res.json({ ...presentEvent(after), notified });
});

export const cancelEvent = catchAsync(async (req: ScopedRequest, res: Response) => {
  const before = await eventInScope(req);
  const hard = req.query.delete === "true";
  if (hard) {
    await prisma.templeEvent.delete({ where: { id: before.id } });
  } else {
    await prisma.templeEvent.update({ where: { id: before.id }, data: { cancelled: true } });
  }
  clearTempleCache();
  await logAudit(actor(req), { templeId: before.templeId, action: hard ? "event.delete" : "event.cancel", entityType: "event", entityId: before.id, summary: `${hard ? "Deleted" : "Cancelled"} event "${before.name}"`, before });
  if (before.published && !before.cancelled && req.query.notify !== "false" && before.date >= todayIn()) await announceEvent(req, before, "cancelled");
  res.json({ ok: true });
});

export const eventResponses = catchAsync(async (req: ScopedRequest, res: Response) => {
  const e = await eventInScope(req);
  const responses = await prisma.eventResponse.findMany({
    where: { eventId: e.id }, orderBy: { createdAt: "asc" },
    include: { user: { select: { name: true, email: true } } },
  });
  const totals = { interested: 0, going: 0, registered: 0, participants: 0 };
  for (const r of responses) {
    totals[r.type as "interested" | "going" | "registered"]++;
    if (r.type !== "interested") totals.participants += r.participants;
  }
  res.json({ totals, responses });
});

// ── Bookings ──────────────────────────────────────────────────

export const listBookings = catchAsync(async (req: ScopedRequest, res: Response) => {
  const q = z.object({
    date: dateStr.optional(), from: dateStr.optional(), to: dateStr.optional(),
    status: z.string().max(30).optional(), category: z.string().max(30).optional(), serviceId: z.string().max(64).optional(),
    payment: z.enum(["pending", "paid", "refunded", "refund_due"]).optional(),
    search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(1000).default(1),
    view: z.enum(["upcoming", "past", "all"]).default("all"),
  }).parse(req.query);
  const now = new Date();
  const where: Prisma.ServiceBookingWhereInput = {
    ...scopeWhere(scopeOf(req)),
    ...(q.date ? { date: q.date } : q.from || q.to ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    ...(q.status ? { status: q.status } : { status: { not: "expired" } }),
    ...(q.category ? { service: { category: q.category } } : {}),
    ...(q.serviceId ? { serviceId: q.serviceId } : {}),
    ...(q.payment === "refund_due" ? { transactions: { some: { type: "refund", status: "pending" } } } : q.payment ? { paymentStatus: q.payment } : {}),
    ...(q.view === "upcoming" ? { scheduledAt: { gte: new Date(now.getTime() - 3 * 3600000) } } : q.view === "past" ? { scheduledAt: { lt: now } } : {}),
    ...(q.search ? { OR: [{ reference: { contains: q.search.toUpperCase() } }, { devoteeName: { contains: q.search } }, { phone: { contains: q.search } }] } : {}),
  };
  const take = 30;
  const [items, total] = await Promise.all([
    prisma.serviceBooking.findMany({
      where, include: bookingInclude, take, skip: (q.page - 1) * take,
      orderBy: q.view === "past" ? [{ scheduledAt: "desc" }] : [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.serviceBooking.count({ where }),
  ]);
  res.json({ items, total, page: q.page, pages: Math.max(1, Math.ceil(total / take)) });
});

async function bookingInScope(req: ScopedRequest) {
  const b = await loadBooking(req.params.id);
  const scope = scopeOf(req);
  if (scope.templeId ? b.templeId !== scope.templeId : b.festivalId !== scope.festivalId) throw new AppError("Booking not found", 404);
  return b;
}

export const getBooking = catchAsync(async (req: ScopedRequest, res: Response) => {
  const b = await bookingInScope(req);
  res.json({ ...presentBooking(b as any, "staff"), cancelQuote: cancellationQuote(b, "staff") });
});

const bookingDetailsSchema = z.object({
  devoteeName: z.string().trim().min(1, "Devotee name is required").max(100),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  gotra: z.string().trim().max(100).optional(),
  nakshatra: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(500).optional(),
  participants: z.number().int().min(1).max(50).default(1),
});

const walkInSchema = bookingDetailsSchema.extend({
  serviceId: z.string().min(1).max(64),
  date: dateStr,
  slotTime: timeStr,
  participation: z.enum(["online", "offline"]).default("offline"),
  amount: z.number().min(0).max(1000000).optional(),
  /** Mark paid immediately with this counter method. */
  paidWith: z.enum(["cash", "upi", "card"]).optional(),
}).strict();

export const createWalkIn = catchAsync(async (req: ScopedRequest, res: Response) => {
  const d = walkInSchema.parse(req.body);
  const service = await loadService(d.serviceId);
  const scope = scopeOf(req);
  if (scope.templeId ? service.templeId !== scope.templeId : service.festivalId !== scope.festivalId) throw new AppError("Service not found", 404);
  const { paidWith, ...input } = d;
  const { booking } = await createServiceBooking({ ...input, paymentMode: "counter" }, { staffId: req.userId, source: "walk_in" });
  let result = booking;
  if (paidWith && booking.paymentStatus === "pending") result = await recordPayment(booking.id, { method: paidWith, recordedById: req.userId, note: "Paid at counter (walk-in)" });
  await logAudit(actor(req), { ...auditScope(req), action: "booking.walk_in", entityType: "booking", entityId: booking.id, summary: `Walk-in booking ${booking.reference} for ${booking.devoteeName} (${booking.service.name}, ${formatSlot(booking.date, booking.slotTime)})` });
  res.status(201).json(result);
});

export const markPaid = catchAsync(async (req: ScopedRequest, res: Response) => {
  const b = await bookingInScope(req);
  const { method, note } = z.object({ method: z.enum(["cash", "upi", "card"]), note: z.string().trim().max(300).optional() }).strict().parse(req.body);
  if (b.paymentStatus !== "pending") throw new AppError(b.paymentStatus === "paid" ? "This booking is already paid" : "No payment is due for this booking");
  if (b.paymentMode === "online" && b.status === "pending_payment") throw new AppError("This booking is awaiting online payment");
  const updated = await recordPayment(b.id, { method, recordedById: req.userId, note });
  await logAudit(actor(req), { ...auditScope(req), action: "booking.mark_paid", entityType: "booking", entityId: b.id, summary: `Recorded ₹${b.amount} ${method} payment for ${b.reference}` });
  res.json(updated);
});

export const settleRefund = catchAsync(async (req: ScopedRequest, res: Response) => {
  const b = await bookingInScope(req);
  const pending = b.transactions.find((t) => t.type === "refund" && t.status === "pending" && t.method === "counter");
  if (!pending) throw new AppError("There's no counter refund waiting for this booking");
  await prisma.paymentTransaction.update({ where: { id: pending.id }, data: { status: "success", recordedById: req.userId, note: "Refund handed over at counter" } });
  await logAudit(actor(req), { ...auditScope(req), action: "booking.refund_settled", entityType: "booking", entityId: b.id, summary: `Handed over ₹${pending.amount} refund for ${b.reference}` });
  res.json(presentBooking((await loadBooking(b.id)) as any, "staff"));
});

export const setBookingStatus = (status: "completed" | "no_show") =>
  catchAsync(async (req: ScopedRequest, res: Response) => {
    const b = await bookingInScope(req);
    if (b.status !== "confirmed") throw new AppError("Only confirmed bookings can be updated");
    const updated = await prisma.serviceBooking.update({
      where: { id: b.id }, data: { status, ...(status === "completed" ? { checkedInAt: new Date() } : {}) }, include: bookingInclude,
    });
    if (status === "completed") await notifyBooking(updated, "completed", "Thank you for your visit 🙏", `${updated.service.name} (Ref ${updated.reference}) is marked complete. May you be blessed.`);
    await logAudit(actor(req), { ...auditScope(req), action: `booking.${status}`, entityType: "booking", entityId: b.id, summary: `Marked ${b.reference} as ${status === "completed" ? "completed / checked in" : "no-show"}` });
    res.json(updated);
  });

export const staffCancel = catchAsync(async (req: ScopedRequest, res: Response) => {
  const b = await bookingInScope(req);
  const { reason, refundPercent } = z.object({ reason: z.string().trim().min(3, "Please give a reason").max(300), refundPercent: z.number().int().min(0).max(100).optional() }).strict().parse(req.body);
  const updated = await cancelServiceBooking(b.id, { by: "staff", actorId: req.userId!, reason, refundPercent });
  await logAudit(actor(req), { ...auditScope(req), action: "booking.cancel", entityType: "booking", entityId: b.id, summary: `Cancelled ${b.reference}${updated.refundAmount ? ` with ₹${updated.refundAmount} refund` : ""}: ${reason}` });
  res.json(updated);
});

export const staffReschedule = catchAsync(async (req: ScopedRequest, res: Response) => {
  const b = await bookingInScope(req);
  const { date, slotTime } = z.object({ date: dateStr, slotTime: timeStr }).strict().parse(req.body);
  const updated = await rescheduleServiceBooking(b.id, { by: "staff", date, slotTime });
  await logAudit(actor(req), { ...auditScope(req), action: "booking.reschedule", entityType: "booking", entityId: b.id, summary: `Rescheduled ${b.reference} from ${formatSlot(b.date, b.slotTime)} to ${formatSlot(date, slotTime)}` });
  res.json(updated);
});

// ── Transactions ──────────────────────────────────────────────

export const listTransactions = catchAsync(async (req: ScopedRequest, res: Response) => {
  const q = z.object({ from: dateStr.optional(), to: dateStr.optional(), type: z.enum(["payment", "refund"]).optional(), page: z.coerce.number().int().min(1).max(1000).default(1) }).parse(req.query);
  const where: Prisma.PaymentTransactionWhereInput = {
    booking: scopeWhere(scopeOf(req)),
    ...(q.type ? { type: q.type } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+05:30`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59+05:30`) } : {}) } } : {}),
  };
  const take = 50;
  const [items, total, sums] = await Promise.all([
    prisma.paymentTransaction.findMany({
      where, orderBy: { createdAt: "desc" }, take, skip: (q.page - 1) * take,
      include: { booking: { select: { id: true, reference: true, devoteeName: true, service: { select: { name: true } } } } },
    }),
    prisma.paymentTransaction.count({ where }),
    prisma.paymentTransaction.groupBy({ by: ["type"], where: { ...where, status: "success" }, _sum: { amount: true } }),
  ]);
  const collected = sums.find((s) => s.type === "payment")?._sum.amount ?? 0;
  const refunded = sums.find((s) => s.type === "refund")?._sum.amount ?? 0;
  res.json({ items, total, page: q.page, pages: Math.max(1, Math.ceil(total / take)), summary: { collected, refunded, net: collected - refunded } });
});

// ── Notifications ─────────────────────────────────────────────

const audienceSchema = z.object({ audience: z.enum(["followers", "community", "both"]).default("both") });

async function audienceFor(req: ScopedRequest, audience: "followers" | "community" | "both") {
  const templeId = scopeOf(req).templeId!;
  const temple = await prisma.temple.findUniqueOrThrow({ where: { id: templeId }, select: { name: true, city: true, state: true, lat: true, lon: true } });
  return {
    temple,
    opts: {
      templeId, kind: "announcement" as const, place: temple,
      includeFollowers: audience !== "community", includeCommunity: audience !== "followers", excludeUserIds: [req.userId!],
    },
  };
}

export const previewAudience = catchAsync(async (req: ScopedRequest, res: Response) => {
  const { audience } = audienceSchema.parse(req.query);
  const { opts } = await audienceFor(req, audience);
  res.json({ count: (await resolveAudience(opts)).length });
});

export const sendAnnouncement = catchAsync(async (req: ScopedRequest, res: Response) => {
  const d = audienceSchema.extend({
    title: z.string().trim().min(3, "Title is too short").max(100),
    body: z.string().trim().min(3, "Message is too short").max(500),
  }).strict().parse(req.body);
  const { temple, opts } = await audienceFor(req, d.audience);
  const reach = await notifyAudience(opts, `${temple.name}: ${d.title}`, d.body, { screen: "TempleDetail" });
  await logAudit(actor(req), {
    templeId: opts.templeId, action: "notification.send", entityType: "notification",
    summary: `Sent "${d.title}" to ${d.audience} (${reach.notified} of ${reach.targeted} reached)`, after: { title: d.title, body: d.body, audience: d.audience, ...reach },
  });
  res.json(reach);
});

export const notificationHistory = catchAsync(async (req: ScopedRequest, res: Response) => {
  const logs = await prisma.auditLog.findMany({ where: { templeId: scopeOf(req).templeId, action: "notification.send" }, orderBy: { createdAt: "desc" }, take: 50 });
  res.json(logs.map((l) => ({ ...l, details: l.changes ? JSON.parse(l.changes) : null })));
});

// ── Audit ─────────────────────────────────────────────────────

export const auditHistory = catchAsync(async (req: ScopedRequest, res: Response) => {
  const page = Math.max(1, Math.min(1000, Number(req.query.page) || 1));
  const where = scopeWhere(scopeOf(req));
  const take = 40;
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take, skip: (page - 1) * take }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ items: items.map((l) => ({ ...l, changes: l.changes ? JSON.parse(l.changes) : null })), total, page, pages: Math.max(1, Math.ceil(total / take)) });
});
