import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { searchTemples, findTemplesByDeity, findTemplesNearby, findFamousTemple } from "../services/temple.service";
import { googlePlaceDetails, isGoogleEnabled } from "../services/google.service";
import { ensureGoogleDetails, saveGoogleTemple } from "../services/templeStore.service";
import { isCurated } from "../services/templeMatcher.service";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { haversineDistance } from "../utils/haversine";

const templeSearchSchema = z.object({ query: z.string().trim().min(1).max(200) });

export const findTemples = catchAsync(async (req: Request, res: Response) => {
  const { query } = templeSearchSchema.parse(req.query);
  res.json(await searchTemples(query));
});

export const findTemplesByDeityHandler = catchAsync(async (req: Request, res: Response) => {
  const input = z.object({
    deity: z.string().trim().min(1),
    searchState: z.string().trim().optional(),
    searchDistrict: z.string().trim().optional(),
    searchMandal: z.string().trim().optional(),
  }).parse(req.body);
  res.json({ success: true, data: await findTemplesByDeity(input) });
});

export const findTemplesNearbyHandler = catchAsync(async (req: Request, res: Response) => {
  const input = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    deity: z.string().optional(),
    radiusKm: z.coerce.number().min(1).max(2000).optional().default(50),
  }).parse(req.query);
  res.json({ success: true, data: await findTemplesNearby(input.lat, input.lng, input.deity, input.radiusKm) });
});

export const mapView = catchAsync(async (req: Request, res: Response) => {
  const { query } = templeSearchSchema.parse(req.query);
  const results = await searchTemples(query);
  res.json(results.filter((r) => r.location).map((r) => ({ name: r.name, placeId: r.placeId, location: r.location })));
});

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Temple details. Only real data is returned: admin-curated fields from our DB,
 * Google Place details when available, or the basic facts we know for famous temples.
 * Fields we don't know are null — the app hides them.
 */
export const getTempleDetail = catchAsync(async (req: Request, res: Response) => {
  const { placeId } = req.params;
  const include = { events: { where: { date: { gte: today() } }, orderBy: { date: "asc" as const } }, templePujas: { orderBy: { name: "asc" as const } } };

  // A temple can be addressed by its own placeId or (for Google-sourced links) its Google place id.
  let dbTemple = await prisma.temple.findUnique({ where: { placeId }, include });
  if (!dbTemple && placeId.startsWith("google:")) {
    dbTemple = await prisma.temple.findUnique({ where: { googlePlaceId: placeId.slice("google:".length) }, include });
  }

  // Unknown Google place (e.g. an old link): fetch it once and store it.
  if (!dbTemple && placeId.startsWith("google:") && isGoogleEnabled()) {
    const d = await googlePlaceDetails(placeId.slice("google:".length)).catch(() => ({} as Awaited<ReturnType<typeof googlePlaceDetails>>));
    if (d.name) {
      const saved = await saveGoogleTemple({
        placeId: placeId.slice("google:".length), name: d.name, address: d.address ?? null, lat: d.lat ?? null, lon: d.lon ?? null,
        rating: d.rating ?? null, reviewCount: d.reviewCount ?? null, phone: d.phone ?? null, website: d.website ?? null, openNow: null, photoRef: null,
      });
      dbTemple = await prisma.temple.findUnique({ where: { id: saved.id }, include });
    }
  }

  // Google phone/website/hours are fetched once and cached on the row.
  if (dbTemple?.googlePlaceId && isGoogleEnabled()) {
    const refreshed = await ensureGoogleDetails(dbTemple);
    if (refreshed !== dbTemple) dbTemple = { ...dbTemple, ...refreshed };
  }

  const famous = findFamousTemple(placeId) ?? (dbTemple ? findFamousTemple(dbTemple.name) : null);
  if (!dbTemple && !famous) throw new AppError("Temple not found", 404);

  let openingHours: string[] | null = null;
  try { openingHours = dbTemple?.openingHours ? JSON.parse(dbTemple.openingHours) : null; } catch {}

  res.json({
    placeId: dbTemple?.placeId ?? placeId,
    name: dbTemple?.name ?? famous?.name,
    deity: dbTemple?.deityName ?? famous?.deity ?? null,
    history: dbTemple?.templeHistory ?? null,
    significance: dbTemple?.significance ?? null,
    sevas: dbTemple?.sevas ?? null,
    contactDetails: dbTemple?.contactDetails ?? dbTemple?.phone ?? null,
    websiteLink: dbTemple?.websiteLink ?? dbTemple?.website ?? null,
    address: dbTemple?.address ?? famous?.address ?? null,
    city: dbTemple?.city ?? famous?.city ?? null,
    state: dbTemple?.state ?? famous?.state ?? null,
    lat: dbTemple?.lat ?? famous?.location?.lat ?? null,
    lon: dbTemple?.lon ?? famous?.location?.lon ?? null,
    rating: dbTemple?.rating ?? null,
    reviewCount: dbTemple?.reviewCount ?? null,
    openingHours,
    openNow: null,
    events: dbTemple?.events ?? [],
    pujas: dbTemple?.templePujas ?? [],
    verified: !!dbTemple && isCurated(dbTemple.source),
    source: dbTemple ? "db" : "famous",
  });
});

export const getTempleTimings = catchAsync(async (req: Request, res: Response) => {
  const pujas = await prisma.templePuja.findMany({ where: { temple: { placeId: req.params.placeId } }, orderBy: { time: "asc" } });
  res.json({ placeId: req.params.placeId, dailySevas: pujas.map((p) => ({ name: p.name, time: p.time, schedule: p.schedule })) });
});

export const getTempleEvents = catchAsync(async (req: Request, res: Response) => {
  const dbTemple = await prisma.temple.findUnique({
    where: { placeId: req.params.placeId },
    include: { events: { where: { date: { gte: today() } }, orderBy: { date: "asc" } }, templePujas: true },
  });
  if (!dbTemple) return res.json({ source: "none", events: [], pujas: [], message: "No events have been published for this temple yet." });
  res.json({ source: "db", events: dbTemple.events, pujas: dbTemple.templePujas });
});

export const getTempleHistory = catchAsync(async (req: Request, res: Response) => {
  const dbTemple = await prisma.temple.findUnique({ where: { placeId: req.params.placeId } });
  res.json({
    placeId: req.params.placeId,
    deity: dbTemple?.deityName ?? findFamousTemple(req.params.placeId)?.deity ?? null,
    history: dbTemple?.templeHistory ?? null,
    significance: dbTemple?.significance ?? null,
  });
});

/** Upcoming events at curated temples near a location. */
export const nearbyTempleEvents = catchAsync(async (req: Request, res: Response) => {
  const { lat, lng, radiusKm } = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusKm: z.coerce.number().min(1).max(2000).optional().default(100),
  }).parse(req.query);
  const events = await prisma.templeEvent.findMany({
    where: { date: { gte: today() }, temple: { lat: { not: null }, lon: { not: null } } },
    include: { temple: true },
    orderBy: { date: "asc" },
    take: 200,
  });
  res.json(events
    .map((e) => ({
      id: e.id, name: e.name, description: e.description, date: e.date, time: e.time,
      temple: { name: e.temple.name, placeId: e.temple.placeId, city: e.temple.city, state: e.temple.state, lat: e.temple.lat, lon: e.temple.lon },
      distanceKm: Math.round(haversineDistance(lat, lng, e.temple.lat!, e.temple.lon!)),
    }))
    .filter((e) => e.distanceKm <= radiusKm)
    .slice(0, 20));
});

// ── Reminders (persisted, owner-only) ──

export const listReminders = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(await prisma.templeReminder.findMany({ where: { userId: req.userId!, placeId: req.params.placeId }, orderBy: { remindAt: "asc" } }));
});

export const setReminder = catchAsync(async (req: AuthRequest, res: Response) => {
  const { remindAt, eventName } = z.object({
    remindAt: z.string().datetime({ offset: true }),
    eventName: z.string().trim().max(200).optional(),
  }).parse(req.body);
  const when = new Date(remindAt);
  if (when.getTime() <= Date.now()) throw new AppError("Reminder time must be in the future", 400);
  const reminder = await prisma.templeReminder.create({
    data: { userId: req.userId!, placeId: req.params.placeId, remindAt: when, eventName: eventName || null },
  });
  res.status(201).json(reminder);
});

export const removeReminder = catchAsync(async (req: AuthRequest, res: Response) => {
  const result = await prisma.templeReminder.deleteMany({ where: { id: req.params.id, userId: req.userId! } });
  if (result.count === 0) throw new AppError("Reminder not found", 404);
  res.status(204).send();
});
