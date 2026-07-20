import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { calculateAstroProfile } from "../services/astrology.service";

async function seed() {
  console.log("🌱 Seeding Temple Connect...\n");

  // ── Admin ──
  const adminHash = await bcrypt.hash("admin123", 10);
  await prisma.user.upsert({
    where: { email: "admin@templeconnect.com" },
    update: {},
    create: { id: "admin-001", name: "Admin", email: "admin@templeconnect.com", passwordHash: adminHash, role: "admin" },
  });

  // ── Pujas ──
  const pujasData = [
    { id: "puja-001", name: "Griha Pravesh", description: "House warming ceremony with Vastu Shanti and Havan", duration: "90-120 mins", basePrice: 5100, category: "home", icon: "🏠" },
    { id: "puja-002", name: "Satyanarayan Puja", description: "Lord Vishnu blessing ceremony for prosperity", duration: "60-75 mins", basePrice: 2100, category: "general", icon: "🙏" },
    { id: "puja-003", name: "Navagraha Shanti", description: "Nine planets appeasement ritual with homa", duration: "90-120 mins", basePrice: 4100, category: "planets", icon: "🪐" },
    { id: "puja-004", name: "Durga Saptashati Path", description: "700-verse recitation of Devi Mahatmyam", duration: "120-180 mins", basePrice: 4500, category: "devi", icon: "🔱" },
    { id: "puja-005", name: "Vastu Shanti", description: "Ritual to harmonize living spaces", duration: "90 mins", basePrice: 3500, category: "home", icon: "🏗️" },
    { id: "puja-006", name: "Wedding Ceremony", description: "Complete traditional Hindu wedding", duration: "180-240 mins", basePrice: 15000, category: "samskara", icon: "💒" },
    { id: "puja-007", name: "Upanayanam", description: "Sacred thread ceremony", duration: "120-180 mins", basePrice: 8000, category: "samskara", icon: "📿" },
    { id: "puja-008", name: "Seemantham", description: "Baby shower for expectant mothers", duration: "60-90 mins", basePrice: 5000, category: "samskara", icon: "🤰" },
    { id: "puja-009", name: "Namakaranam", description: "Baby naming ceremony based on Nakshatra", duration: "45-60 mins", basePrice: 3000, category: "samskara", icon: "👶" },
    { id: "puja-010", name: "Astrology Consultation", description: "Full birth chart analysis", duration: "45-60 mins", basePrice: 2100, category: "astrology", icon: "⭐" },
    { id: "puja-011", name: "Kundali Matching", description: "Marriage compatibility analysis", duration: "30-45 mins", basePrice: 1500, category: "astrology", icon: "💑" },
    { id: "puja-012", name: "Mahalakshmi Puja", description: "Elaborate Lakshmi worship for prosperity", duration: "75-90 mins", basePrice: 3500, category: "devi", icon: "💰" },
    { id: "puja-013", name: "Meditation & Yoga", description: "Guided meditation with personalized yoga", duration: "45-60 mins", basePrice: 1100, category: "spiritual", icon: "🧘" },
    { id: "puja-014", name: "Spiritual Counseling", description: "Life guidance per Vedantic philosophy", duration: "45-60 mins", basePrice: 1000, category: "spiritual", icon: "🕉️" },
    { id: "puja-015", name: "Ganapati Homa", description: "Fire ritual for Lord Ganesha", duration: "60-90 mins", basePrice: 3000, category: "general", icon: "🐘" },
    { id: "puja-016", name: "Rudrabhishekam", description: "Shiva Lingam abhishek with 11 dravyas", duration: "90-120 mins", basePrice: 5100, category: "shaiva", icon: "🕉️" },
    { id: "puja-017", name: "Lakshmi Narayana Homa", description: "Prosperity fire ritual", duration: "75-90 mins", basePrice: 3500, category: "general", icon: "🔥" },
    { id: "puja-018", name: "Dosha Nivaran Puja", description: "Ritual for specific doshas", duration: "60-90 mins", basePrice: 4100, category: "planets", icon: "🛡️" },
  ];
  for (const p of pujasData) {
    await prisma.puja.upsert({ where: { id: p.id }, update: {}, create: p });
  }
  console.log("✅ 18 Pujas");

  // ── Priests ──
  const priestHash = await bcrypt.hash("priest123", 10);
  const priestsData = [
    { id: "priest-001", name: "Pandit Ramesh Sharma", email: "ramesh.sharma@temple.com", phone: "+91-9876543210", languages: "Hindi, English, Sanskrit", rating: 4.7, reviewCount: 156, verified: true, experienceYears: 22, qualifications: "Vedic Studies - Kashi Vidyapith", bio: "Expert Vedic priest specializing in house warming and Vastu ceremonies.", pujaIds: ["puja-001", "puja-002", "puja-005", "puja-015", "puja-017"] },
    { id: "priest-002", name: "Acharya Suresh Gupta", email: "suresh.gupta@temple.com", phone: "+91-9876543211", languages: "Hindi, English, Punjabi", rating: 4.9, reviewCount: 312, verified: true, experienceYears: 28, qualifications: "PhD Astrology - BHU", bio: "Renowned astrologer specializing in birth chart analysis.", pujaIds: ["puja-003", "puja-010", "puja-011", "puja-018", "puja-016"] },
    { id: "priest-003", name: "Swami Narayan Das", email: "narayan.das@temple.com", phone: "+91-9876543212", languages: "Hindi, English, Kannada, Tamil", rating: 4.8, reviewCount: 420, verified: true, experienceYears: 35, qualifications: "Vedanta Philosophy - Sivananda Ashram", bio: "Spiritual master guiding seekers through meditation and yoga.", pujaIds: ["puja-013", "puja-014", "puja-002", "puja-016"] },
    { id: "priest-004", name: "Pandit Venkateswara Rao", email: "venkatesh.rao@temple.com", phone: "+91-9876543213", languages: "Telugu, Sanskrit, Tamil, English", rating: 4.6, reviewCount: 198, verified: true, experienceYears: 18, qualifications: "Agama Shastra - TTD Certified", bio: "Traditional Telugu priest specializing in all Samskaras.", pujaIds: ["puja-006", "puja-007", "puja-008", "puja-009", "puja-002", "puja-001"] },
    { id: "priest-005", name: "Mata Anandi Devi", email: "anandi.devi@temple.com", phone: "+91-9876543214", languages: "Hindi, Marathi, Gujarati, English", rating: 4.5, reviewCount: 145, verified: true, experienceYears: 15, qualifications: "Shakta Tradition - Kamakhya Peeth", bio: "Female priest specializing in Devi worship.", pujaIds: ["puja-004", "puja-012", "puja-002", "puja-008", "puja-009"] },
  ];
  for (const p of priestsData) {
    const eu = await prisma.user.findUnique({ where: { email: p.email } });
    let uid = eu?.id;
    if (!eu) { const u = await prisma.user.create({ data: { id: p.id + "-user", name: p.name, email: p.email, passwordHash: priestHash, role: "priest" } }); uid = u.id; }
    await prisma.priest.upsert({
      where: { id: p.id }, update: {},
      create: { id: p.id, userId: uid, name: p.name, phone: p.phone, languages: p.languages, rating: p.rating, reviewCount: p.reviewCount, verified: p.verified, experienceYears: p.experienceYears, qualifications: p.qualifications, bio: p.bio },
    });
    for (const pid of p.pujaIds) {
      await prisma.priestPuja.upsert({ where: { priestId_pujaId: { priestId: p.id, pujaId: pid } }, update: {}, create: { priestId: p.id, pujaId: pid } });
    }
  }
  console.log("✅ 5 Priests with pujas");

  // ── Devotees ──
  const devHash = await bcrypt.hash("dev123", 10);
  const devs = [
    { id: "dev-001", name: "Arun Kumar", email: "arun@example.com", dob: "1990-03-15", time: "08:30", place: "Chennai, India", lat: 13.0827, lng: 80.2707 },
    { id: "dev-002", name: "Priya Sharma", email: "priya@example.com", dob: "1992-07-22", time: "14:15", place: "Mumbai, India", lat: 19.0760, lng: 72.8777 },
    { id: "dev-003", name: "Rajesh Patel", email: "rajesh@example.com", dob: "1985-11-08", time: "06:45", place: "Ahmedabad, India", lat: 23.0225, lng: 72.5714 },
    { id: "dev-004", name: "Deepa Reddy", email: "deepa@example.com", dob: "1995-01-30", time: "22:10", place: "Hyderabad, India", lat: 17.3850, lng: 78.4867 },
    { id: "dev-005", name: "Vikram Singh", email: "vikram@example.com", dob: "1988-09-05", time: "11:00", place: "Jaipur, India", lat: 26.9124, lng: 75.7873 },
  ];
  for (const d of devs) {
    await prisma.user.upsert({ where: { email: d.email }, update: {}, create: { id: d.id, name: d.name, email: d.email, passwordHash: devHash, role: "devotee" } });
    const profile = calculateAstroProfile(d.dob, d.time, d.lat, d.lng);
    await prisma.birthChart.upsert({ where: { userId: d.id }, update: {}, create: { userId: d.id, dob: d.dob, time: d.time, placeName: d.place, lat: d.lat, lon: d.lng, nakshatra: profile.nakshatra.name, rashi: profile.rashi.name } });
  }
  console.log("✅ 5 Devotees");

  // ── Bookings (2 per devotee — 1 confirmed, 1 completed) ──
  const now = new Date();
  const bookingsData = [
    { userId: "dev-001", priestId: "priest-001", pujaId: "puja-001", scheduled: 3, status: "confirmed", paid: true },
    { userId: "dev-001", priestId: "priest-002", pujaId: "puja-010", scheduled: -7, status: "completed", paid: true },
    { userId: "dev-002", priestId: "priest-005", pujaId: "puja-012", scheduled: 2, status: "confirmed", paid: true },
    { userId: "dev-002", priestId: "priest-003", pujaId: "puja-013", scheduled: -14, status: "completed", paid: true },
    { userId: "dev-003", priestId: "priest-004", pujaId: "puja-006", scheduled: 10, status: "confirmed", paid: true },
    { userId: "dev-003", priestId: "priest-001", pujaId: "puja-002", scheduled: -5, status: "completed", paid: true },
    { userId: "dev-004", priestId: "priest-002", pujaId: "puja-018", scheduled: 5, status: "pending", paid: false },
    { userId: "dev-004", priestId: "priest-003", pujaId: "puja-014", scheduled: -10, status: "completed", paid: true },
    { userId: "dev-005", priestId: "priest-001", pujaId: "puja-005", scheduled: 7, status: "pending", paid: false },
    { userId: "dev-005", priestId: "priest-005", pujaId: "puja-004", scheduled: -3, status: "completed", paid: true },
  ];
  for (const b of bookingsData) {
    const puja = await prisma.puja.findUnique({ where: { id: b.pujaId } });
    await prisma.booking.create({ data: { userId: b.userId, priestId: b.priestId, pujaId: b.pujaId, scheduledAt: new Date(now.getTime() + b.scheduled * 86400000), status: b.status, paid: b.paid, amount: puja?.basePrice || 1000 } });
  }
  console.log("✅ 10 Bookings");

  // ── FAQs ──
  for (const f of [
    { question: "How do I book a puja?", answer: "Go to Connect tab → Book a Puja → Select puja → Choose priest → Confirm. The priest will then accept or suggest another time." },
    { question: "How to get my astrology profile?", answer: "Home tab → Enter Birth Details → Calculate. Your Nakshatra, Rashi, and recommended deity will be shown." },
    { question: "Can I cancel a booking?", answer: "From My Bookings, tap on a pending booking to cancel. Free if 24hrs before the scheduled time." },
  ]) { await prisma.faq.create({ data: f }); }

  // ── Daily suggestions ──
  for (const s of [
    { nakshatra: "Revati", rashi: null, title: "Vishnu Sahasranama", body: "Recite Vishnu Sahasranama today. Offer tulsi leaves and yellow flowers to Lord Vishnu.", type: "nakshatra" },
    { nakshatra: null, rashi: null, title: "Morning Surya Arghya", body: "Wake before sunrise. Offer water to the rising Sun. Chant 'Om Suryaya Namah' 12 times.", type: "general" },
    { nakshatra: null, rashi: null, title: "Evening Diya", body: "Light a diya near your Tulsi plant or home altar. Sit in silence for 5 minutes after lighting it.", type: "general" },
  ]) { await prisma.dailySuggestion.create({ data: s }); }

  const counts = { users: await prisma.user.count(), pujas: await prisma.puja.count(), priests: await prisma.priest.count(), bookings: await prisma.booking.count() };
  console.log(`\n✅ Done! Users:${counts.users} Pujas:${counts.pujas} Priests:${counts.priests} Bookings:${counts.bookings}\n`);
  process.exit(0);
}
seed().catch(e => { console.error(e); process.exit(1); });
