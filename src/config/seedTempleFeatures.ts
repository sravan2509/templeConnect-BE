import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

/**
 * Demo data for temple Sevas / Poojas / events / Pushkaraalu, a temple admin login, and a festival.
 * Idempotent: safe to run repeatedly. Never runs in production (see seed.ts).
 */
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => day(from + i)).join(",");

export async function seedTempleFeatures(prisma: PrismaClient) {
  const temple = await prisma.temple.findFirst({ where: { name: "Durga Temple", city: "Eluru" } })
    ?? await prisma.temple.upsert({
      where: { placeId: "csv:durga temple|eluru" },
      update: {},
      create: { placeId: "csv:durga temple|eluru", name: "Durga Temple", deityName: "Durga", city: "Eluru", state: "Andhra Pradesh", lat: 16.7107, lon: 81.0952, source: "import" },
    });

  await prisma.temple.update({
    where: { id: temple.id },
    data: {
      cancelHoursBefore: 24, refundPercent: 90, rescheduleHoursBefore: 12, maxReschedules: 2, allowCounterPayment: true,
      policyNotes: "Cancellations up to 24 hours before receive a 90% refund. Please carry your booking reference.",
      openingHours: temple.openingHours ?? "5:30 AM – 12:30 PM, 4:00 PM – 8:30 PM",
      phone: temple.phone ?? "+91 8812 000000",
    },
  });

  // ── Temple admin login ──
  const adminEmail = "durga.admin@temple.com";
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: "temple_admin" },
    create: { id: "temple-admin-001", name: "Durga Temple Office", email: adminEmail, passwordHash: await bcrypt.hash("temple123", 10), role: "temple_admin" },
  });
  await prisma.templeStaff.upsert({ where: { userId: adminUser.id }, update: { templeId: temple.id }, create: { userId: adminUser.id, templeId: temple.id, title: "Executive Officer" } });

  // ── Sevas, Poojas, Pushkaraalu, special ──
  const services = [
    { id: "svc-kumkum-archana", category: "seva", name: "Kumkum Archana", description: "Archana with kumkum and 108 names of the Goddess, performed in your name and gotra.", price: 116, durationMins: 20, timings: "Daily, morning & evening", materials: "Provided by the temple", participation: "both", daysOfWeek: "0,1,2,3,4,5,6", slotTimes: "06:00,07:00,08:00,17:00,18:00", capacityPerSlot: 15 },
    { id: "svc-abhishekam", category: "seva", name: "Panchamrutha Abhishekam", description: "Sacred bathing of the deity with milk, curd, ghee, honey and sugar.", price: 516, durationMins: 45, timings: "Daily 6:30 AM & 8:30 AM", materials: "Optional: bring milk & flowers", participation: "offline", daysOfWeek: "0,1,2,3,4,5,6", slotTimes: "06:30,08:30", capacityPerSlot: 10 },
    { id: "svc-annadanam", category: "seva", name: "Annadanam Donation", description: "Sponsor the free meal (prasadam) served to devotees. Donate any amount from ₹500.", price: 500, priceType: "donation", durationMins: null, timings: "Daily at noon", materials: null, participation: "both", daysOfWeek: "0,1,2,3,4,5,6", slotTimes: "12:00", capacityPerSlot: 500 },
    { id: "svc-chandi-homam", category: "pooja", name: "Chandi Homam", description: "Fire ritual to Goddess Chandi for protection and removal of obstacles. Performed by temple priests.", price: 5116, durationMins: 180, timings: "Fridays & Sundays, 9:00 AM", materials: "Ghee, samidha, navadhanyam, silk saree (temple can arrange for ₹1,500)", participation: "both", daysOfWeek: "0,5", slotTimes: "09:00", capacityPerSlot: 4 },
    { id: "svc-navagraha", category: "pooja", name: "Navagraha Pooja", description: "Pooja to the nine planets to ease doshas.", price: 1116, durationMins: 60, timings: "Saturdays", materials: "Navadhanyam, 9 colours of cloth", participation: "both", daysOfWeek: "6", slotTimes: "07:00,10:00", capacityPerSlot: 6 },
    { id: "svc-temple-pushkara", category: "pushkaralu", name: "Pushkara Snanam Sankalpam", description: "Sankalpam and holy dip arranged by the temple during Pushkaraalu, followed by darshan.", price: 2116, durationMins: 90, timings: "Pushkaraalu days, early morning", materials: "Fresh clothes, towel", participation: "both", daysOfWeek: "0,1,2,3,4,5,6", slotTimes: "05:00,06:00,07:00", capacityPerSlot: 25, availableFrom: day(7), availableTo: day(18), advanceDays: 120 },
    { id: "svc-kalyanotsavam", category: "special", name: "Kalyanotsavam", description: "Celestial wedding ceremony of the deities. Couples may participate in person.", price: 2500, durationMins: 120, timings: "Sundays, 10:00 AM", materials: "Provided by the temple", participation: "both", daysOfWeek: "0", slotTimes: "10:00", capacityPerSlot: 20 },
  ];
  for (const s of services) {
    const data = { ...s, priceType: s.priceType ?? "fixed", templeId: temple.id };
    await prisma.templeService.upsert({ where: { id: s.id }, update: {}, create: data });
  }

  // ── Events ──
  const events = [
    {
      id: "evt-karthika-deepotsavam", name: "Karthika Deepotsavam", date: day(5), time: "18:00", endTime: "21:00",
      description: "Lighting of 10,008 lamps around the temple, followed by Harathi and prasadam. Families welcome.",
      venue: "Temple courtyard", contactName: "Temple Office", contactPhone: "+91 8812 000000", registrationType: "interest",
      registrationInfo: "Bring your own diya if you like; oil and wicks are provided.",
    },
    {
      id: "evt-kumkum-pooja-ladies", name: "Samuhika Kumkum Pooja (for women)", date: day(12), time: "10:00", endTime: "12:30",
      description: "Community kumkum pooja for women. Pooja kit and prasadam included.", venue: "Kalyana Mandapam",
      contactName: "Smt. Lakshmi (Coordinator)", contactPhone: "+91 90000 00000", registrationType: "registration", capacity: 100,
      registrationInfo: "Registration required. Please arrive 30 minutes early with your registration name.",
    },
  ];
  for (const e of events) {
    await prisma.templeEvent.upsert({ where: { id: e.id }, update: {}, create: { ...e, templeId: temple.id, createdById: adminUser.id } });
  }

  // ── Standalone festival (Pushkaraalu) ──
  const festival = await prisma.festival.upsert({
    where: { id: "fest-godavari-pushkaralu" },
    update: {},
    create: {
      id: "fest-godavari-pushkaralu", name: "Godavari Pushkaraalu (demo)", river: "Godavari", startDate: day(20), endDate: day(31),
      description: "Demo festival for testing: replace with the official Pushkaraalu dates. Holy dip, sankalpam and pinda pradanam at the main ghats.",
    },
  });
  const ghats = [
    { id: "ghat-pushkar-rjy", name: "Pushkar Ghat", city: "Rajahmundry", state: "Andhra Pradesh", lat: 17.0005, lon: 81.7799, description: "Main bathing ghat near the Godavari bridge." },
    { id: "ghat-kotilingala-rjy", name: "Kotilingala Ghat", city: "Rajahmundry", state: "Andhra Pradesh", lat: 17.0087, lon: 81.7683, description: "Large ghat with dedicated pinda pradanam area." },
    { id: "ghat-bhadrachalam", name: "Bhadrachalam Ghat", city: "Bhadrachalam", state: "Telangana", lat: 17.668, lon: 80.893, description: "Ghat below the Sri Sita Ramachandra Swamy temple." },
  ];
  for (const g of ghats) await prisma.festivalGhat.upsert({ where: { id: g.id }, update: {}, create: { ...g, festivalId: festival.id } });

  const festDates = range(20, 31);
  const festServices = [
    { id: "fsvc-snanam-pushkar", ghatId: "ghat-pushkar-rjy", name: "Pushkara Snanam Sankalpam", description: "Guided sankalpam with a purohit before the holy dip.", price: 300, durationMins: 30, slotTimes: "05:00,06:00,07:00,08:00,09:00", capacityPerSlot: 200, participation: "offline", materials: "Fresh clothes, towel" },
    { id: "fsvc-pinda-kotilingala", ghatId: "ghat-kotilingala-rjy", name: "Pinda Pradanam", description: "Ancestral offerings performed by experienced purohits. Can be done on your behalf (online).", price: 1500, durationMins: 60, slotTimes: "06:00,08:00,10:00", capacityPerSlot: 30, participation: "both", materials: "Purohit provides all materials" },
    { id: "fsvc-harathi-bhadrachalam", ghatId: "ghat-bhadrachalam", name: "Godavari Harathi (reserved seating)", description: "Reserved seating for the evening Godavari Harathi.", price: 1000, durationMins: 60, slotTimes: "18:30", capacityPerSlot: 100, participation: "offline", materials: null },
  ];
  for (const s of festServices) {
    await prisma.templeService.upsert({
      where: { id: s.id },
      update: {},
      create: { ...s, category: "pushkaralu", festivalId: festival.id, specificDates: festDates, advanceDays: 120, timings: "During the festival" },
    });
  }

  // ── Devotee preferences so notifications have an audience ──
  const arun = await prisma.user.findUnique({ where: { email: "arun@example.com" } });
  if (arun) await prisma.templeFollow.upsert({ where: { userId_templeId: { userId: arun.id, templeId: temple.id } }, update: {}, create: { userId: arun.id, templeId: temple.id } });
  const priya = await prisma.user.findUnique({ where: { email: "priya@example.com" } });
  if (priya) {
    await prisma.communityArea.upsert({ where: { userId_city_state: { userId: priya.id, city: "Eluru", state: "Andhra Pradesh" } }, update: {}, create: { userId: priya.id, city: "Eluru", state: "Andhra Pradesh" } });
  }

  console.log(`✅ Temple features: ${temple.name} (admin ${adminEmail} / temple123), ${services.length} services, ${events.length} events, festival "${festival.name}"`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed demo data in production");
    process.exit(1);
  }
  seedTempleFeatures(prisma).then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
}
