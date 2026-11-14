import axios from "axios";
import { prisma } from "../config/prisma";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH_SIZE = 100;

type PrefKey =
  | "pujaReminders" | "templeEventAlerts" | "bookingUpdates" | "promotionalOffers" | "dailySuggestions"
  | "sevaUpdates" | "templeAnnouncements" | "communityEvents" | "festivalUpdates";

/** Schema defaults, used for users who never saved preferences. */
const PREF_DEFAULTS: Record<PrefKey, boolean> = {
  pujaReminders: true, templeEventAlerts: true, bookingUpdates: true, promotionalOffers: false, dailySuggestions: true,
  sevaUpdates: true, templeAnnouncements: true, communityEvents: true, festivalUpdates: true,
};

/** Which notification-preference toggle controls each notification type. */
export function prefFor(type: string | undefined): PrefKey | null {
  if (!type) return null;
  if (type === "puja_reminder" || type === "booking_reminder") return "pujaReminders";
  if (type.startsWith("booking_") || type === "new_booking") return "bookingUpdates";
  if (type === "daily_suggestion") return "dailySuggestions";
  if (type === "temple_event") return "templeEventAlerts";
  if (type === "community_event") return "communityEvents";
  if (type === "seva_update") return "sevaUpdates";
  if (type === "temple_announcement") return "templeAnnouncements";
  if (type === "festival_update") return "festivalUpdates";
  if (type === "promotion") return "promotionalOffers";
  return null;
}

async function isAllowed(userId: string, type: string | undefined): Promise<boolean> {
  const key = prefFor(type);
  if (!key) return true;
  const prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
  if (!prefs) return PREF_DEFAULTS[key];
  return prefs[key];
}

type PushMessage = { to: string; title: string; body: string; data?: Record<string, string> };

async function deliver(messages: PushMessage[]) {
  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    const chunk = messages.slice(i, i + EXPO_BATCH_SIZE).map((m) => ({ sound: "default", priority: "high", data: {}, ...m }));
    try {
      await axios.post(EXPO_PUSH_URL, chunk, { headers: { "Content-Type": "application/json" }, timeout: 15000 });
    } catch (err: any) {
      console.error(`[PUSH] Batch delivery failed (${chunk.length} messages): ${err.message}`);
    }
  }
}

/**
 * Stores an in-app notification and sends a device push, honouring the user's
 * notification preferences. Never throws: callers fire-and-forget it.
 */
export async function sendPushNotification(userId: string, title: string, body: string, data?: Record<string, string>): Promise<boolean> {
  try {
    if (!(await isAllowed(userId, data?.type))) return false;

    await prisma.notification.create({
      data: { userId, title, body, type: data?.type || "push", data: data ? JSON.stringify(data) : null },
    });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { pushToken: true } });
    if (user?.pushToken) {
      await deliver([{ to: user.pushToken, title, body, data }]);
      console.log(`[PUSH] Sent to ${userId}: ${title}`);
    }
    return true;
  } catch (err: any) {
    console.error(`[PUSH] Failed for user ${userId}: ${err.message}`);
    return false;
  }
}

export interface Recipient {
  userId: string;
  /** Notification type for this recipient; decides which preference toggle applies. */
  type: string;
}

/**
 * Sends one notification to many users in bulk: filters by each user's preference for their
 * notification type, stores in-app notifications and pushes in batches. Returns how many were notified.
 */
export async function notifyRecipients(recipients: Recipient[], title: string, body: string, data: Record<string, string> = {}): Promise<number> {
  const byUser = new Map<string, string>();
  for (const r of recipients) if (!byUser.has(r.userId)) byUser.set(r.userId, r.type);
  if (byUser.size === 0) return 0;

  const ids = [...byUser.keys()];
  const [prefs, users] = await Promise.all([
    prisma.notificationPreference.findMany({ where: { userId: { in: ids } } }),
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, pushToken: true } }),
  ]);
  const prefByUser = new Map(prefs.map((p) => [p.userId, p]));

  const allowed = users.filter((u) => {
    const key = prefFor(byUser.get(u.id));
    if (!key) return true;
    const p = prefByUser.get(u.id);
    return p ? p[key] : PREF_DEFAULTS[key];
  });
  if (allowed.length === 0) return 0;

  await prisma.notification.createMany({
    data: allowed.map((u) => {
      const type = byUser.get(u.id)!;
      return { userId: u.id, title, body, type, data: JSON.stringify({ ...data, type }) };
    }),
  });
  await deliver(
    allowed.filter((u) => u.pushToken).map((u) => ({ to: u.pushToken!, title, body, data: { ...data, type: byUser.get(u.id)! } }))
  );
  console.log(`[PUSH] "${title}" → ${allowed.length}/${byUser.size} recipients`);
  return allowed.length;
}

export async function sendPushToAll(title: string, body: string, data?: Record<string, string>) {
  const users = await prisma.user.findMany({ select: { id: true } });
  const sent = await notifyRecipients(users.map((u) => ({ userId: u.id, type: data?.type || "push" })), title, body, data);
  console.log(`[PUSH] Broadcast "${title}" to ${sent}/${users.length} users`);
  return sent;
}
