import { Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { prisma } from "../config/prisma";
import { INDIAN_STATES } from "../data/indianStates";
import { sendPushNotification } from "../services/push.service";
import { getAllFamousTemples } from "../services/temple.service";
import { haversineDistance } from "../utils/haversine";
import { NAKSHATRAS } from "../data/nakshatraData";
import { RASHIS } from "../data/rashiData";

// ── Notifications ───────────────────────────────────────────

export const getNotifications = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(await prisma.notification.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: "desc" }, take: 50 }));
});

export const markRead = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.notification.updateMany({ where: { userId: req.userId!, id: req.params.id }, data: { read: true } });
  res.json({ success: true });
});

export const markAllRead = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.notification.updateMany({ where: { userId: req.userId!, read: false }, data: { read: true } });
  res.json({ success: true });
});

export const getUnreadCount = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json({ count: await prisma.notification.count({ where: { userId: req.userId!, read: false } }) });
});

// ── Daily suggestions ───────────────────────────────────────

type Chart = { nakshatra: string | null; rashi: string | null } | null | undefined;

/** A suggestion applies when each of its targeting fields is empty or matches the user's chart. */
function suggestionMatches(s: { nakshatra: string | null; rashi: string | null }, chart: Chart) {
  return (!s.nakshatra || s.nakshatra === chart?.nakshatra) && (!s.rashi || s.rashi === chart?.rashi);
}

function dayOfYear(d = new Date()) {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000);
}

function pickSuggestion<T extends { nakshatra: string | null; rashi: string | null }>(all: T[], chart: Chart): T | null {
  // Prefer suggestions targeted at the user's star/sign over generic ones.
  const targeted = all.filter((s) => (s.nakshatra || s.rashi) && suggestionMatches(s, chart));
  const pool = targeted.length > 0 ? targeted : all.filter((s) => suggestionMatches(s, chart));
  return pool.length ? pool[dayOfYear() % pool.length] : null;
}

export const getDailySuggestion = catchAsync(async (req: AuthRequest, res: Response) => {
  const [chart, all] = await Promise.all([
    prisma.birthChart.findUnique({ where: { userId: req.userId! } }),
    prisma.dailySuggestion.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  res.json(pickSuggestion(all, chart) ?? { title: "Jai Shri Ram", body: "Start your day with prayer and positivity." });
});

export const sendDailySuggestionPush = catchAsync(async (_req: AuthRequest, res: Response) => {
  const [users, all] = await Promise.all([
    prisma.user.findMany({ select: { id: true, birthChart: { select: { nakshatra: true, rashi: true } } } }),
    prisma.dailySuggestion.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  let sent = 0;
  for (const user of users) {
    const s = pickSuggestion(all, user.birthChart);
    if (s && (await sendPushNotification(user.id, s.title, s.body, { type: "daily_suggestion" }))) sent++;
  }
  res.json({ sent, total: users.length });
});

const nakshatraNames = NAKSHATRAS.map((n) => n.name) as [string, ...string[]];
const rashiNames = RASHIS.map((r) => r.name) as [string, ...string[]];
const sugSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(1000),
  nakshatra: z.enum(nakshatraNames).nullable().optional(),
  rashi: z.enum(rashiNames).nullable().optional(),
  type: z.string().trim().max(30).optional(),
}).strict();

export const listSuggestions = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.json(await prisma.dailySuggestion.findMany({ orderBy: { createdAt: "desc" } }));
});

export const createSuggestion = catchAsync(async (req: AuthRequest, res: Response) => {
  res.status(201).json(await prisma.dailySuggestion.create({ data: sugSchema.parse(req.body) }));
});

export const updateSuggestion = catchAsync(async (req: AuthRequest, res: Response) => {
  res.json(await prisma.dailySuggestion.update({ where: { id: req.params.id }, data: sugSchema.partial().parse(req.body) }));
});

export const deleteSuggestion = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.dailySuggestion.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// ── Search helpers ──────────────────────────────────────────

export const autocompletePlaces = catchAsync(async (req: AuthRequest, res: Response) => {
  const q = ((req.query.q as string) || "").toLowerCase().trim();
  if (q.length < 2) return res.json([]);

  const states = INDIAN_STATES.filter((s) => s.toLowerCase().includes(q)).map((s) => ({ label: s, type: "state" }));

  const dbTemples = await prisma.temple.findMany({
    where: { OR: [{ name: { contains: q } }, { city: { contains: q } }, { deityName: { contains: q } }] },
    take: 8,
    orderBy: { name: "asc" },
  });
  const seen = new Set(dbTemples.map((t) => t.name.toLowerCase()));
  const famous = getAllFamousTemples().filter(
    (t) => !seen.has(t.name.toLowerCase()) && (t.name.toLowerCase().includes(q) || t.city?.toLowerCase().includes(q))
  );

  const temples = [
    ...dbTemples.map((t) => ({ label: [t.name, t.city].filter(Boolean).join(", "), type: "temple", placeId: t.placeId })),
    ...famous.map((t) => ({ label: [t.name, t.city].filter(Boolean).join(", "), type: "temple", placeId: t.placeId })),
  ].slice(0, 8);

  res.json([...states, ...temples].slice(0, 10));
});

export const getMapTemples = catchAsync(async (req: AuthRequest, res: Response) => {
  const lat = req.query.lat ? parseFloat(req.query.lat as string) : NaN;
  const lng = req.query.lng ? parseFloat(req.query.lng as string) : NaN;
  const state = req.query.state as string | undefined;

  const dbTemples = await prisma.temple.findMany({
    where: { lat: { not: null }, lon: { not: null }, ...(state ? { state } : {}) },
    take: 500,
  });
  const seen = new Set(dbTemples.map((t) => t.name.toLowerCase()));
  const all = [
    ...dbTemples.map((t) => ({ id: t.placeId, name: t.name, lat: t.lat!, lng: t.lon!, city: t.city, state: t.state })),
    ...getAllFamousTemples()
      .filter((t) => !seen.has(t.name.toLowerCase()) && (!state || t.state === state) && t.location)
      .map((t) => ({ id: t.placeId, name: t.name, lat: t.location!.lat, lng: t.location!.lon, city: t.city ?? null, state: t.state ?? null })),
  ];

  if (!isNaN(lat) && !isNaN(lng)) {
    all.sort((a, b) => haversineDistance(lat, lng, a.lat, a.lng) - haversineDistance(lat, lng, b.lat, b.lng));
  }
  res.json(all.slice(0, 100));
});
