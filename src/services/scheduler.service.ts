import { prisma } from "../config/prisma";
import { bookingInclude, formatSlot, notifyBooking, PAYMENT_HOLD_MINUTES, placeName, slotInstant, todayIn } from "./serviceBooking.service";
import { notifyRecipients } from "./push.service";

const TICK_MS = 5 * 60 * 1000;
/** Reminders go out once a booking is within this many hours. */
const REMINDER_HOURS = 24;

/** Releases slots held by online bookings that were never paid. */
export async function expireUnpaidHolds(): Promise<number> {
  const cutoff = new Date(Date.now() - PAYMENT_HOLD_MINUTES * 60000);
  const { count } = await prisma.serviceBooking.updateMany({
    where: { status: "pending_payment", createdAt: { lt: cutoff } },
    data: { status: "expired" },
  });
  return count;
}

export async function sendDueReminders(): Promise<number> {
  const now = new Date();
  const due = await prisma.serviceBooking.findMany({
    where: {
      status: "confirmed", reminderSentAt: null, userId: { not: null },
      scheduledAt: { gt: now, lte: new Date(now.getTime() + REMINDER_HOURS * 3600000) },
    },
    include: bookingInclude,
    take: 200,
  });
  for (const b of due) {
    await prisma.serviceBooking.update({ where: { id: b.id }, data: { reminderSentAt: now } });
    const pay = b.paymentStatus === "pending" ? ` Please pay ₹${b.amount} at the counter.` : "";
    const how = b.participation === "online" ? "will be performed on your behalf" : "is coming up — please arrive 15 minutes early";
    await notifyBooking({ ...b }, "reminder", "Booking Reminder 🔔",
      `${b.service.name} at ${placeName(b)} ${how}: ${formatSlot(b.date, b.slotTime)}. Ref ${b.reference}.${pay}`, { wait: true });
  }
  return due.length;
}

/** Reminds devotees who are going to / registered for an event, about a day before it starts. */
export async function sendEventReminders(): Promise<number> {
  const now = Date.now();
  const events = await prisma.templeEvent.findMany({
    where: { published: true, cancelled: false, date: { gte: todayIn(), lte: todayIn(undefined, 2) } },
    include: {
      temple: { select: { name: true } },
      responses: { where: { type: { in: ["going", "registered"] }, reminderSentAt: null }, select: { id: true, userId: true } },
    },
  });
  let sent = 0;
  for (const e of events) {
    if (!e.responses.length) continue;
    // Events without a clock time are treated as starting at 9 AM.
    const start = slotInstant(e.date, /^\d{2}:\d{2}$/.test(e.time ?? "") ? e.time! : "09:00", "Asia/Kolkata").getTime();
    if (start <= now || start - now > REMINDER_HOURS * 3600000) continue;
    await prisma.eventResponse.updateMany({ where: { id: { in: e.responses.map((r) => r.id) } }, data: { reminderSentAt: new Date() } });
    sent += await notifyRecipients(
      e.responses.map((r) => ({ userId: r.userId, type: "temple_event" })),
      `Reminder: ${e.name}`,
      `${e.temple.name} · ${formatSlot(e.date, /^\d{2}:\d{2}$/.test(e.time ?? "") ? e.time! : "09:00").replace(/, 9:00 AM$/, "")}${e.venue ? ` · ${e.venue}` : ""}. See you there 🙏`,
      { eventId: e.id, screen: "EventDetail" },
    );
  }
  return sent;
}

let timer: NodeJS.Timeout | null = null;

export function startScheduler() {
  if (timer) return;
  const tick = async () => {
    try {
      const expired = await expireUnpaidHolds();
      const reminded = await sendDueReminders();
      const eventReminders = await sendEventReminders();
      if (expired || reminded || eventReminders) {
        console.log(`[SCHEDULER] expired ${expired} unpaid hold(s), sent ${reminded} booking and ${eventReminders} event reminder(s)`);
      }
    } catch (err: any) {
      console.error(`[SCHEDULER] ${err.message}`);
    }
  };
  setTimeout(tick, 10000);
  timer = setInterval(tick, TICK_MS);
  timer.unref();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
