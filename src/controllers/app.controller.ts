import { Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { prisma } from "../config/prisma";
import { FAMOUS_TEMPLES, FamousTemple } from "../data/famousTemples";
import { INDIAN_STATES } from "../data/indianStates";
import { sendPushNotification, sendPushToAll } from "../services/push.service";
import { searchTemples } from "../services/temple.service";

export const getNotifications = catchAsync(async (req: AuthRequest, res: Response) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(notifications);
});

export const markRead = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.notification.updateMany({
    where: { userId: req.userId!, id: req.params.id },
    data: { read: true },
  });
  res.json({ success: true });
});

export const markAllRead = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.notification.updateMany({
    where: { userId: req.userId!, read: false },
    data: { read: true },
  });
  res.json({ success: true });
});

export const getUnreadCount = catchAsync(async (req: AuthRequest, res: Response) => {
  const count = await prisma.notification.count({
    where: { userId: req.userId!, read: false },
  });
  res.json({ count });
});

export const getDailySuggestion = catchAsync(async (req: AuthRequest, res: Response) => {
  const chart = await prisma.birthChart.findUnique({ where: { userId: req.userId! } });

  let suggestions = await prisma.dailySuggestion.findMany({
    where: {
      OR: [
        ...(chart?.nakshatra ? [{ nakshatra: chart.nakshatra }] : []),
        ...(chart?.rashi ? [{ rashi: chart.rashi }] : []),
        { nakshatra: null, rashi: null },
      ],
    },
  });

  if (suggestions.length === 0) {
    suggestions = await prisma.dailySuggestion.findMany({ where: { nakshatra: null, rashi: null } });
  }

  const today = new Date();
  const dayIndex = (today.getDate() + today.getMonth() * 31) % suggestions.length;
  res.json(suggestions[dayIndex] || { title: "Jai Shri Ram", body: "Start your day with prayer and positivity." });
});

export const sendDailySuggestionPush = catchAsync(async (_req: AuthRequest, res: Response) => {
  const users = await prisma.user.findMany({
    where: { pushToken: { not: null } },
    select: { id: true, birthChart: { select: { nakshatra: true, rashi: true } } },
  });

  const allSuggestions = await prisma.dailySuggestion.findMany();
  const today = new Date();
  const dayIndex = (today.getDate() + today.getMonth() * 31);

  let sent = 0;
  for (const user of users) {
    const relevant = allSuggestions.filter((s) =>
      !s.nakshatra || s.nakshatra === user.birthChart?.nakshatra ||
      !s.rashi || s.rashi === user.birthChart?.rashi
    );
    const suggestion = relevant.length > 0
      ? relevant[dayIndex % relevant.length]
      : allSuggestions[dayIndex % allSuggestions.length];

    if (suggestion) {
      await sendPushNotification(user.id, suggestion.title, suggestion.body, { type: "daily_suggestion" });
      sent++;
    }
  }

  res.json({ sent, total: users.length });
});

export const autocompletePlaces = catchAsync(async (req: AuthRequest, res: Response) => {
  const q = ((req.query.q as string) || "").toLowerCase().trim();
  if (q.length < 2) return res.json([]);

  const states = INDIAN_STATES.filter((s) => s.toLowerCase().includes(q)).map((s) => ({ label: s, type: "state" }));

  const allTemples = getAllTemples();
  const temples = allTemples
    .filter((t) => t.name.toLowerCase().includes(q) || t.city?.toLowerCase().includes(q))
    .slice(0, 8)
    .map((t) => ({ label: `${t.name}, ${t.city}`, type: "temple", placeId: t.placeId }));

  const results = [...states, ...temples].slice(0, 10);
  res.json(results);
});

export const getMapTemples = catchAsync(async (req: AuthRequest, res: Response) => {
  const lat = parseFloat((req.query.lat as string) || "0");
  const lng = parseFloat((req.query.lng as string) || "0");
  const deity = req.query.deity as string | undefined;
  const state = req.query.state as string | undefined;

  let temples: any[] = [];

  if (deity && FAMOUS_TEMPLES[deity]) {
    temples = FAMOUS_TEMPLES[deity];
  } else if (state) {
    temples = getAllTemples().filter((t) => t.state === state);
  } else {
    temples = getAllTemples().slice(0, 30);
  }

  res.json(temples.map((t) => ({
    id: t.placeId || `famous:${t.name}`,
    name: t.name,
    lat: t.lat || t.location?.lat,
    lng: t.lng || t.location?.lon,
    city: t.city,
    state: t.state,
  })));
});

function getAllTemples(): any[] {
  const results: any[] = [];
  const seen = new Set<string>();
  for (const temples of Object.values(FAMOUS_TEMPLES)) {
    for (const t of temples) {
      if (!seen.has(t.name)) { seen.add(t.name); results.push(t); }
    }
  }
  return results;
}
