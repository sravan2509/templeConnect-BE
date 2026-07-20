import axios from "axios";
import { prisma } from "../config/prisma";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export async function sendPushNotification(userId: string, title: string, body: string, data?: Record<string, string>) {
  await prisma.notification.create({
    data: {
      userId,
      title,
      body,
      type: data?.type || "push",
      data: data ? JSON.stringify(data) : null,
    },
  });

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { pushToken: true } });
    if (!user?.pushToken) {
      console.log(`[PUSH] No device token for user ${userId}, in-app notification saved only`);
      return;
    }

    await axios.post(EXPO_PUSH_URL, {
      to: user.pushToken,
      sound: "default",
      title,
      body,
      data: data || {},
      priority: "high",
    }, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });

    console.log(`[PUSH] Device notification sent to user ${userId}: ${title}`);
  } catch (err: any) {
    console.error(`[PUSH] Device push failed for user ${userId}: ${err.message}`);
  }
}

export async function sendPushToAll(title: string, body: string, data?: Record<string, string>) {
  const users = await prisma.user.findMany({
    where: { pushToken: { not: null } },
    select: { id: true, pushToken: true },
  });

  for (const user of users) {
    await prisma.notification.create({
      data: {
        userId: user.id,
        title,
        body,
        type: data?.type || "broadcast",
        data: data ? JSON.stringify(data) : null,
      },
    });

    if (!user.pushToken) continue;

    try {
      await axios.post(EXPO_PUSH_URL, {
        to: user.pushToken,
        sound: "default",
        title,
        body,
        data: data || {},
        priority: "high",
      }, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });
    } catch (err: any) {
      console.error(`[PUSH] Broadcast failed for ${user.id}: ${err.message}`);
    }
  }

  console.log(`[PUSH] Broadcast: ${users.length} in-app + ${users.filter(u => u.pushToken).length} device notifications`);
}
