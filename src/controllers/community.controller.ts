import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { AuthRequest, authenticateToken } from "../middleware/auth";
import { haversineDistance } from "../utils/haversine";
import { availability, BOOKING_CUTOFF_MINUTES, CATEGORY_LABELS, csv, dateUnavailableReason, isValidDate, loadService, policyOf, slotInstant, todayIn, tzOf } from "../services/serviceBooking.service";

/** Accepts either the temple's id or its placeId (what search results carry). */
export async function findTemple(ref: string) {
  const temple = await prisma.temple.findFirst({ where: { OR: [{ id: ref }, { placeId: ref }] } });
  if (!temple) throw new AppError("Temple not found", 404);
  return temple;
}

/** Signed-in user id when a valid token is present; these endpoints also work signed out. */
async function optionalUserId(req: Request): Promise<string | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return (await authenticateToken(header.slice(7)))?.userId ?? null;
}

const publicServiceSelect = {
  id: true, templeId: true, festivalId: true, ghatId: true, category: true, name: true, description: true, price: true, priceType: true,
  durationMins: true, timings: true, materials: true, participation: true, daysOfWeek: true, slotTimes: true, capacityPerSlot: true,
  availableFrom: true, availableTo: true, specificDates: true, advanceDays: true, bookingEnabled: true, imageUrl: true, updatedAt: true,
} as const;

export function presentPublicService(s: any) {
  return { ...s, daysOfWeek: csv(s.daysOfWeek).map(Number), slotTimes: csv(s.slotTimes), specificDates: csv(s.specificDates), categoryLabel: CATEGORY_LABELS[s.category] ?? s.category };
}

export function presentEvent(e: any) {
  let images: string[] = [];
  try { images = e.images ? JSON.parse(e.images) : []; } catch {}
  return { ...e, images };
}

const upcomingEventWhere = (today: string): Prisma.TempleEventWhereInput => ({
  published: true, cancelled: false, OR: [{ date: { gte: today } }, { endDate: { gte: today } }],
});

// ── Temple page ───────────────────────────────────────────────

export const templeOverview = catchAsync(async (req: Request, res: Response) => {
  const temple = await findTemple(req.params.ref);
  const userId = await optionalUserId(req);
  const today = todayIn();
  const [services, events, follow, followers] = await Promise.all([
    prisma.templeService.findMany({ where: { templeId: temple.id, active: true }, select: publicServiceSelect, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    prisma.templeEvent.findMany({ where: { templeId: temple.id, ...upcomingEventWhere(today) }, orderBy: { date: "asc" }, take: 20 }),
    userId ? prisma.templeFollow.findUnique({ where: { userId_templeId: { userId, templeId: temple.id } } }) : Promise.resolve(null),
    prisma.templeFollow.count({ where: { templeId: temple.id } }),
  ]);
  res.json({
    temple: { id: temple.id, placeId: temple.placeId, name: temple.name, city: temple.city, state: temple.state, imageUrl: temple.imageUrl, followers },
    policy: policyOf(temple),
    services: services.map(presentPublicService),
    events: events.map(presentEvent),
    follow,
  });
});

export const serviceDetail = catchAsync(async (req: Request, res: Response) => {
  const s = await prisma.templeService.findUnique({
    where: { id: req.params.id },
    select: {
      ...publicServiceSelect, active: true,
      temple: { select: { id: true, placeId: true, name: true, city: true, state: true, address: true, lat: true, lon: true, cancelHoursBefore: true, refundPercent: true, rescheduleHoursBefore: true, maxReschedules: true, allowCounterPayment: true, policyNotes: true } },
      festival: { select: { id: true, name: true, river: true, startDate: true, endDate: true } },
      ghat: { select: { id: true, name: true, city: true, state: true, lat: true, lon: true } },
    },
  });
  if (!s || !s.active) throw new AppError("This service is no longer available", 404);
  res.json({ ...presentPublicService(s), policy: policyOf(s.temple as any) });
});

export const serviceAvailabilityPublic = catchAsync(async (req: Request, res: Response) => {
  const service = await loadService(req.params.id);
  const date = String(req.query.date ?? "");
  if (!isValidDate(date)) throw new AppError("Choose a valid date");
  res.json(await availability(service, date));
});

/** Upcoming bookable dates for a service (next N days), so the app can grey out the rest. */
export const serviceDates = catchAsync(async (req: Request, res: Response) => {
  const service = await loadService(req.params.id);
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), service.advanceDays, 120);
  const tz = tzOf(service);
  const cutoff = Date.now() + BOOKING_CUTOFF_MINUTES * 60000;
  const out: string[] = [];
  for (let i = 0; i <= days; i++) {
    const d = todayIn(tz, i);
    if (dateUnavailableReason(service, d)) continue;
    // Skip today once every slot has closed, so the app opens on a date that can actually be booked.
    if (i === 0 && !csv(service.slotTimes).some((t) => slotInstant(d, t, tz).getTime() > cutoff)) continue;
    out.push(d);
  }
  res.json({ dates: out });
});

/** All bookable services in a category across temples (e.g. Pushkaraalu poojas). */
export const servicesByCategory = catchAsync(async (req: Request, res: Response) => {
  const category = z.enum(["seva", "pooja", "pushkaralu", "special"]).parse(req.query.category);
  const services = await prisma.templeService.findMany({
    where: { category, active: true, templeId: { not: null } },
    select: { ...publicServiceSelect, temple: { select: { id: true, placeId: true, name: true, city: true, state: true } } },
    orderBy: { name: "asc" }, take: 200,
  });
  res.json(services.map(presentPublicService));
});

// ── Follows ───────────────────────────────────────────────────

export const listFollows = catchAsync(async (req: AuthRequest, res: Response) => {
  const follows = await prisma.templeFollow.findMany({
    where: { userId: req.userId! }, orderBy: { createdAt: "desc" },
    include: { temple: { select: { id: true, placeId: true, name: true, city: true, state: true, deityName: true, imageUrl: true } } },
  });
  res.json(follows);
});

const followFlags = z.object({ notifySevas: z.boolean(), notifyEvents: z.boolean(), notifyAnnouncements: z.boolean() }).partial().strict();

export const followTemple = catchAsync(async (req: AuthRequest, res: Response) => {
  const { templeRef, ...flags } = followFlags.extend({ templeRef: z.string().min(1).max(200) }).strict().parse(req.body);
  const temple = await findTemple(templeRef);
  const follow = await prisma.templeFollow.upsert({
    where: { userId_templeId: { userId: req.userId!, templeId: temple.id } },
    create: { userId: req.userId!, templeId: temple.id, ...flags },
    update: flags,
  });
  res.status(201).json(follow);
});

export const updateFollow = catchAsync(async (req: AuthRequest, res: Response) => {
  const flags = followFlags.parse(req.body);
  const temple = await findTemple(req.params.templeRef);
  const result = await prisma.templeFollow.updateMany({ where: { userId: req.userId!, templeId: temple.id }, data: flags });
  if (!result.count) throw new AppError("You don't follow this temple", 404);
  res.json(await prisma.templeFollow.findUnique({ where: { userId_templeId: { userId: req.userId!, templeId: temple.id } } }));
});

export const unfollowTemple = catchAsync(async (req: AuthRequest, res: Response) => {
  const temple = await findTemple(req.params.templeRef);
  await prisma.templeFollow.deleteMany({ where: { userId: req.userId!, templeId: temple.id } });
  res.status(204).send();
});

// ── Community settings (areas + home radius) ──────────────────

export const getCommunitySettings = catchAsync(async (req: AuthRequest, res: Response) => {
  const [user, areas, follows] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.userId! }, select: { homeLat: true, homeLon: true, homeLabel: true, communityRadiusKm: true } }),
    prisma.communityArea.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: "asc" } }),
    prisma.templeFollow.count({ where: { userId: req.userId! } }),
  ]);
  res.json({
    areas: areas.map((a) => ({ id: a.id, city: a.city, state: a.state })),
    home: user?.homeLat != null ? { lat: user.homeLat, lon: user.homeLon, label: user.homeLabel } : null,
    radiusKm: user?.communityRadiusKm ?? null,
    followCount: follows,
  });
});

const settingsSchema = z.object({
  areas: z.array(z.object({ city: z.string().trim().min(1).max(100), state: z.string().trim().max(100).default("") })).max(20).optional(),
  home: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), label: z.string().trim().max(200).optional() }).nullable().optional(),
  radiusKm: z.number().int().min(0).max(500).nullable().optional(),
}).strict();

export const updateCommunitySettings = catchAsync(async (req: AuthRequest, res: Response) => {
  const d = settingsSchema.parse(req.body);
  const userId = req.userId!;
  await prisma.$transaction(async (tx) => {
    if (d.areas) {
      await tx.communityArea.deleteMany({ where: { userId } });
      const seen = new Set<string>();
      for (const a of d.areas) {
        const key = `${a.city.toLowerCase()}|${a.state.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await tx.communityArea.create({ data: { userId, city: a.city, state: a.state } });
      }
    }
    if (d.home !== undefined || d.radiusKm !== undefined) {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(d.home !== undefined ? { homeLat: d.home?.lat ?? null, homeLon: d.home?.lon ?? null, homeLabel: d.home?.label ?? null } : {}),
          ...(d.radiusKm !== undefined ? { communityRadiusKm: d.radiusKm } : {}),
        },
      });
    }
  });
  return getCommunitySettings(req, res, () => {});
});

/** Town / village / district suggestions: places that have temples, plus Indian districts. */
export const searchPlaces = catchAsync(async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  if (q.length < 2) return res.json([]);
  const temples = await prisma.temple.findMany({
    where: { city: { contains: q } }, select: { city: true, state: true }, distinct: ["city", "state"], take: 15,
  });
  const out = new Map<string, { city: string; state: string; kind: string }>();
  for (const t of temples) if (t.city) out.set(`${t.city}|${t.state ?? ""}`.toLowerCase(), { city: t.city, state: t.state ?? "", kind: "town" });
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lib = require("india-states-districts");
    const states: string[] = lib.getAllStates?.() ?? [];
    for (const state of states) {
      for (const district of (lib.getDistrictsByState?.(state) ?? []) as string[]) {
        if (district.toLowerCase().includes(q)) out.set(`${district}|${state}`.toLowerCase(), { city: district, state, kind: "district" });
        if (out.size >= 25) break;
      }
    }
  } catch {}
  res.json([...out.values()].slice(0, 25));
});

// ── Events ────────────────────────────────────────────────────

const eventInclude = { temple: { select: { id: true, placeId: true, name: true, city: true, state: true, lat: true, lon: true, address: true } } } as const;

/**
 * Upcoming events relevant to the devotee: from followed temples, their chosen areas, and
 * their saved home radius. `scope=nearby` uses the given coordinates instead.
 */
export const eventFeed = catchAsync(async (req: AuthRequest, res: Response) => {
  const q = z.object({
    scope: z.enum(["mine", "nearby", "all"]).default("mine"),
    lat: z.coerce.number().min(-90).max(90).optional(), lon: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().min(1).max(500).default(50),
  }).parse(req.query);
  const today = todayIn();
  const userId = req.userId!;
  const all = await prisma.templeEvent.findMany({ where: upcomingEventWhere(today), include: eventInclude, orderBy: { date: "asc" }, take: 500 });

  const [follows, areas, user, responses] = await Promise.all([
    prisma.templeFollow.findMany({ where: { userId }, select: { templeId: true, notifyEvents: true } }),
    prisma.communityArea.findMany({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { homeLat: true, homeLon: true, communityRadiusKm: true } }),
    prisma.eventResponse.findMany({ where: { userId }, select: { eventId: true, type: true } }),
  ]);
  const followed = new Set(follows.map((f) => f.templeId));
  const areaKeys = areas.map((a) => ({ city: a.city.toLowerCase(), state: a.state.toLowerCase() }));
  const myResponse = new Map(responses.map((r) => [r.eventId, r.type]));

  const placeOf = (e: (typeof all)[number]) => ({
    city: (e.city ?? e.temple.city ?? "").toLowerCase(), state: (e.state ?? e.temple.state ?? "").toLowerCase(),
    lat: e.lat ?? e.temple.lat, lon: e.lon ?? e.temple.lon,
  });

  const items = all.flatMap((e) => {
    const p = placeOf(e);
    const reasons: string[] = [];
    let distanceKm: number | null = null;
    if (q.scope === "nearby") {
      if (q.lat == null || q.lon == null || p.lat == null || p.lon == null) return [];
      distanceKm = haversineDistance(q.lat, q.lon, p.lat, p.lon);
      if (distanceKm > q.radiusKm) return [];
      reasons.push("nearby");
    } else {
      if (followed.has(e.templeId)) reasons.push("following");
      if (areaKeys.some((a) => a.city === p.city && (!a.state || !p.state || a.state === p.state))) reasons.push("your area");
      if (user?.homeLat != null && user.communityRadiusKm && p.lat != null && p.lon != null) {
        distanceKm = haversineDistance(user.homeLat, user.homeLon!, p.lat, p.lon);
        if (distanceKm <= user.communityRadiusKm) reasons.push("near home");
      }
      if (q.scope === "mine" && !reasons.length) return [];
    }
    return [{ ...presentEvent(e), reasons, distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null, myResponse: myResponse.get(e.id) ?? null }];
  });

  res.json({ items, configured: followed.size > 0 || areas.length > 0 || !!user?.communityRadiusKm });
});

export const eventDetail = catchAsync(async (req: Request, res: Response) => {
  const e = await prisma.templeEvent.findUnique({ where: { id: req.params.id }, include: eventInclude });
  if (!e || !e.published) throw new AppError("Event not found", 404);
  const userId = await optionalUserId(req);
  const [counts, mine] = await Promise.all([
    prisma.eventResponse.groupBy({ by: ["type"], where: { eventId: e.id }, _count: true, _sum: { participants: true } }),
    userId ? prisma.eventResponse.findUnique({ where: { eventId_userId: { eventId: e.id, userId } } }) : Promise.resolve(null),
  ]);
  const totals = { interested: 0, going: 0, registered: 0, participants: 0 };
  for (const c of counts) {
    totals[c.type as keyof typeof totals] = c._count;
    if (c.type !== "interested") totals.participants += c._sum.participants ?? 0;
  }
  const spotsLeft = e.capacity ? Math.max(0, e.capacity - totals.participants) : null;
  res.json({ ...presentEvent(e), totals, spotsLeft, myResponse: mine });
});

export const respondToEvent = catchAsync(async (req: AuthRequest, res: Response) => {
  const d = z.object({
    type: z.enum(["interested", "going", "registered"]),
    participants: z.number().int().min(1).max(20).default(1),
    name: z.string().trim().max(100).optional(), phone: z.string().trim().max(20).optional(),
  }).strict().parse(req.body);
  const e = await prisma.templeEvent.findUnique({ where: { id: req.params.id } });
  if (!e || !e.published) throw new AppError("Event not found", 404);
  if (e.cancelled) throw new AppError("This event has been cancelled");
  if ((e.endDate ?? e.date) < todayIn()) throw new AppError("This event is over");
  if (e.registrationType === "none") throw new AppError("This event doesn't take registrations");
  if (d.type === "registered" && e.registrationType !== "registration") throw new AppError("This event doesn't need registration. Mark yourself as going instead.");
  if (d.type === "registered" && !d.name) throw new AppError("Please enter the name to register");

  const result = await prisma.$transaction(async (tx) => {
    if (e.capacity && d.type !== "interested") {
      const agg = await tx.eventResponse.aggregate({ where: { eventId: e.id, type: { not: "interested" }, userId: { not: req.userId! } }, _sum: { participants: true } });
      if ((agg._sum.participants ?? 0) + d.participants > e.capacity) throw new AppError("Sorry, this event is full", 409);
    }
    const data = { type: d.type, participants: d.type === "interested" ? 1 : d.participants, name: d.name, phone: d.phone };
    return tx.eventResponse.upsert({
      where: { eventId_userId: { eventId: e.id, userId: req.userId! } },
      create: { eventId: e.id, userId: req.userId!, ...data },
      update: data,
    });
  });
  res.status(201).json(result);
});

export const withdrawEventResponse = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.eventResponse.deleteMany({ where: { eventId: req.params.id, userId: req.userId! } });
  res.status(204).send();
});

// ── Festivals (Pushkaraalu) ───────────────────────────────────

export const listFestivals = catchAsync(async (_req: Request, res: Response) => {
  const today = todayIn();
  const [festivals, templePushkaralu] = await Promise.all([
    prisma.festival.findMany({
      where: { active: true, endDate: { gte: today } }, orderBy: { startDate: "asc" },
      include: { _count: { select: { ghats: true, services: { where: { active: true } } } } },
    }),
    prisma.templeService.findMany({
      where: { category: "pushkaralu", active: true, templeId: { not: null } },
      select: { ...publicServiceSelect, temple: { select: { id: true, placeId: true, name: true, city: true, state: true } } },
      orderBy: { name: "asc" }, take: 100,
    }),
  ]);
  res.json({ festivals, templeServices: templePushkaralu.map(presentPublicService) });
});

export const festivalDetail = catchAsync(async (req: Request, res: Response) => {
  const f = await prisma.festival.findUnique({
    where: { id: req.params.id },
    include: {
      ghats: { orderBy: { name: "asc" } },
      services: { where: { active: true }, select: publicServiceSelect, orderBy: { name: "asc" } },
    },
  });
  if (!f || !f.active) throw new AppError("Festival not found", 404);
  res.json({ ...f, services: f.services.map(presentPublicService), policy: policyOf(null) });
});
