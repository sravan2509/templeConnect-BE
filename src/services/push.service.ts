import axios from "axios";
import { prisma } from "../config/prisma";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type PrefKey = "pujaReminders" | "templeEventAlerts" | "bookingUpdates" | "promotionalOffers" | "dailySuggestions";

/** Which notification-preference toggle controls each notification type. */
function prefFor(type: string | undefined): PrefKey | null {
  if (!type) return null;
  if (type.startsWith("booking_") || type === "new_booking") return "bookingUpdates";
  if (type === "daily_suggestion") return "dailySuggestions";
  if (type === "puja_reminder") return "pujaReminders";
  if (type === "temple_event") return "templeEventAlerts";
  if (type === "promotion") return "promotionalOffers";
  return null;
}

async function isAllowed(userId: string, type: string | undefined): Promise<boolean> {
  const key = prefFor(type);
  if (!key) return true;
  const prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
  if (!prefs) return key !== "promotionalOffers"; // schema defaults: promotions off, everything else on
  return prefs[key];
}

async function deliverToDevice(pushToken: string, title: string, body: string, data?: Record<string, string>) {
  await axios.post(
    EXPO_PUSH_URL,
    { to: pushToken, sound: "default", title, body, data: data || {}, priority: "high" },
    { headers: { "Content-Type": "application/json" }, timeout: 10000 }
  );
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
      await deliverToDevice(user.pushToken, title, body, data);
      console.log(`[PUSH] Sent to ${userId}: ${title}`);
    }
    return true;
  } catch (err: any) {
    console.error(`[PUSH] Failed for user ${userId}: ${err.message}`);
    return false;
  }
}

export async function sendPushToAll(title: string, body: string, data?: Record<string, string>) {
  const users = await prisma.user.findMany({ select: { id: true } });
  let sent = 0;
  for (const user of users) {
    if (await sendPushNotification(user.id, title, body, data)) sent++;
  }
  console.log(`[PUSH] Broadcast "${title}" to ${sent}/${users.length} users`);
  return sent;
}
