// Central in-memory placeholder data for features with no real data source yet
// (Connect bookings/priests, Profile subscriptions/payments/checkins/donations, and
// static seed content like dos-and-donts / knowledge base). Resets on server restart.
// Replace with real DB-backed models in the next phase.

import { randomUUID } from "crypto";

export const dosAndDonts = [
  "Remove footwear before entering the temple premises.",
  "Dress modestly — cover shoulders and knees.",
  "Switch off or silence your phone inside the sanctum.",
  "Avoid turning your back to the deity when leaving.",
  "Do not touch idols unless permitted by temple priests.",
];

export const knowledgeBaseArticles = [
  { id: "kb-1", title: "Why We Ring the Temple Bell", category: "cultural", summary: "The significance of the ghanti before darshan." },
  { id: "kb-2", title: "The Story of Hanuman", category: "kids", summary: "A short story for children about devotion and strength." },
  { id: "kb-3", title: "How to Perform Namaskar Correctly", category: "etiquette", summary: "Step-by-step guide to greeting deities respectfully." },
  { id: "kb-4", title: "Meaning of Prasad", category: "cultural", summary: "Why offerings are shared after puja." },
  { id: "kb-5", title: "Ganesha and the Moon", category: "kids", summary: "An animated micro-video retelling a classic tale." },
  { id: "kb-6", title: "Temple Dress Code Explained", category: "etiquette", summary: "What to wear (and avoid) when visiting a temple." },
];

export const forecastByRashi: Record<string, string> = {
  Vrishabha: "A stable and grounded period ahead — favorable for financial decisions and long-term commitments.",
  Mesha: "High energy and initiative — a good time to start new ventures, but watch for impatience.",
  Mithuna: "Communication and learning are highlighted — expect useful conversations and new ideas.",
  Karka: "Emotional and family matters take center stage — nurture close relationships.",
  Simha: "Confidence and recognition grow — a good period for leadership and visibility.",
  Kanya: "Focus sharpens on health and daily routines — small disciplined changes pay off.",
  Tula: "Balance and partnerships are favored — good time for collaboration and diplomacy.",
  Vrishchika: "Transformation and deep focus — good for research, introspection, and resolving old matters.",
  Dhanu: "Optimism and travel are favored — a good time for higher learning or pilgrimage.",
  Makara: "Discipline and career matters are highlighted — steady effort brings recognition.",
  Kumbha: "Innovation and community connections grow — good for group efforts and new ideas.",
  Meena: "Intuition and spirituality are heightened — a favorable time for rituals and reflection.",
};

export const recommendationsByRashi: Record<string, string[]> = {
  Vrishabha: ["Lakshmi Puja on Fridays", "Chant the Vishnu Sahasranama", "Donate to a Venus-associated cause"],
  Mesha: ["Hanuman Chalisa on Tuesdays", "Offer red flowers to Mangal", "Fast on Tuesdays"],
};
const defaultRecommendations = ["Visit a nearby temple this week", "Light a diya during morning prayers", "Practice gratitude journaling"];
export function getRecommendationsFor(rashi: string | null): string[] {
  return (rashi ? recommendationsByRashi[rashi] : undefined) ?? defaultRecommendations;
}

// ---- Connect: priests / bookings (fully mock) ----

export interface MockPriest {
  id: string;
  name: string;
  specialization: string[];
  languages: string[];
  rating: number;
  reviewCount: number;
  verified: boolean;
  experienceYears: number;
  qualifications: string[];
  services: { id: string; name: string; price: number; durationMins: number }[];
  availability: string[]; // ISO date strings
}

export const priests: MockPriest[] = [
  {
    id: "priest-1",
    name: "Pandit Sharma",
    specialization: ["Griha Pravesh", "Satyanarayan Puja"],
    languages: ["Hindi", "Telugu", "English"],
    rating: 4.5,
    reviewCount: 128,
    verified: true,
    experienceYears: 18,
    qualifications: ["Vedic Studies, Kashi Vidyapith", "Certified Purohit — 2006"],
    services: [
      { id: "svc-1", name: "Griha Pravesh", price: 3500, durationMins: 90 },
      { id: "svc-2", name: "Satyanarayan Puja", price: 2500, durationMins: 60 },
    ],
    availability: ["2026-07-20T09:00:00Z", "2026-07-20T11:00:00Z", "2026-07-21T09:00:00Z"],
  },
  {
    id: "priest-2",
    name: "Acharya Gupta",
    specialization: ["Astrology Consultation", "Navagraha Puja"],
    languages: ["Hindi", "English"],
    rating: 5,
    reviewCount: 240,
    verified: true,
    experienceYears: 25,
    qualifications: ["Jyotish Acharya, Banaras Hindu University"],
    services: [
      { id: "svc-3", name: "Astrology Consultation", price: 1500, durationMins: 45 },
      { id: "svc-4", name: "Navagraha Puja", price: 4000, durationMins: 120 },
    ],
    availability: ["2026-07-19T10:00:00Z", "2026-07-22T15:00:00Z"],
  },
];

export const priestReviews: Record<string, { id: string; author: string; rating: number; comment: string }[]> = {
  "priest-1": [
    { id: "rev-1", author: "Ravi K.", rating: 5, comment: "Very thorough and punctual." },
    { id: "rev-2", author: "Meena S.", rating: 4, comment: "Great experience overall." },
  ],
  "priest-2": [{ id: "rev-3", author: "Anita R.", rating: 5, comment: "Incredibly insightful consultation." }],
};

export interface MockBooking {
  id: string;
  userId: string;
  priestId: string;
  serviceId: string;
  scheduledAt: string;
  status: "pending" | "confirmed" | "cancelled" | "completed";
  paid: boolean;
}

export const bookings: MockBooking[] = [
  {
    id: "booking-1",
    userId: "mock-user-id",
    priestId: "priest-1",
    serviceId: "svc-1",
    scheduledAt: "2026-07-25T09:00:00Z",
    status: "confirmed",
    paid: true,
  },
];

export function createBooking(userId: string, priestId: string, serviceId: string, scheduledAt: string): MockBooking {
  const booking: MockBooking = {
    id: `booking-${randomUUID()}`,
    userId,
    priestId,
    serviceId,
    scheduledAt,
    status: "pending",
    paid: false,
  };
  bookings.push(booking);
  return booking;
}

// ---- Profile: subscriptions / payments / checkins / donations (fully mock) ----

export interface MockSubscription {
  plan: "free" | "premium_monthly" | "premium_yearly";
  renewsAt: string | null;
  paymentMethod: string | null;
}

export const subscriptionsByUser = new Map<string, MockSubscription>();

export function getSubscription(userId: string): MockSubscription {
  if (!subscriptionsByUser.has(userId)) {
    subscriptionsByUser.set(userId, { plan: "free", renewsAt: null, paymentMethod: null });
  }
  return subscriptionsByUser.get(userId)!;
}

export interface MockCheckin {
  id: string;
  userId: string;
  templeName: string;
  visitedAt: string;
}

export const checkins: MockCheckin[] = [
  { id: "checkin-1", userId: "mock-user-id", templeName: "Hanuman Temple", visitedAt: "2026-07-10T06:30:00Z" },
  { id: "checkin-2", userId: "mock-user-id", templeName: "Shiva Temple", visitedAt: "2026-06-21T07:00:00Z" },
];

export interface MockDonation {
  id: string;
  userId: string;
  templeName: string;
  amount: number;
  donatedAt: string;
}

export const donations: MockDonation[] = [
  { id: "donation-1", userId: "mock-user-id", templeName: "Shiva Temple", amount: 501, donatedAt: "2026-06-20T00:00:00Z" },
  { id: "donation-2", userId: "mock-user-id", templeName: "Krishna Temple", amount: 1100, donatedAt: "2026-05-02T00:00:00Z" },
];

// ---- Notification preferences (mock, not persisted to DB yet) ----

export interface NotificationPreferences {
  pujaReminders: boolean;
  templeEventAlerts: boolean;
  bookingUpdates: boolean;
  promotionalOffers: boolean;
}

export const notificationPreferencesByUser = new Map<string, NotificationPreferences>();

export function getNotificationPreferences(userId: string): NotificationPreferences {
  if (!notificationPreferencesByUser.has(userId)) {
    notificationPreferencesByUser.set(userId, {
      pujaReminders: true,
      templeEventAlerts: true,
      bookingUpdates: true,
      promotionalOffers: false,
    });
  }
  return notificationPreferencesByUser.get(userId)!;
}

// ---- Temple supplementary content (mock — no live source for these yet) ----

export function mockTempleTimings(placeId: string) {
  return {
    placeId,
    openTime: "05:30",
    closeTime: "21:00",
    dailySevas: [
      { name: "Suprabhata Seva", time: "05:30" },
      { name: "Morning Aarti", time: "08:00" },
      { name: "Evening Aarti", time: "19:00" },
    ],
  };
}

export function mockTempleEvents(placeId: string) {
  return [
    { id: "event-1", placeId, name: "Monthly Abhishekam", date: "2026-07-28" },
    { id: "event-2", placeId, name: "Annual Brahmotsavam", date: "2026-09-10" },
  ];
}

export function mockTempleHistory(placeId: string) {
  return {
    placeId,
    deity: "Lord Venkateswara",
    builtCentury: "16th century",
    history: "According to local tradition, this temple was established by a local ruling dynasty and has been a center of worship for centuries.",
    speciality: "Known for its daily Suprabhata Seva and annual Brahmotsavam festival.",
  };
}

const reminders = new Map<string, { id: string; placeId: string; userId: string }>();

export function createReminder(userId: string, placeId: string) {
  const reminder = { id: `reminder-${randomUUID()}`, placeId, userId };
  reminders.set(reminder.id, reminder);
  return reminder;
}

export function deleteReminder(id: string) {
  return reminders.delete(id);
}
