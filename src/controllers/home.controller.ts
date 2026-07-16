import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { dosAndDonts } from "../data/mockStore";

export const dashboard = catchAsync(async (_req: Request, res: Response) => {
  res.json({
    greeting: "Namaste 🙏",
    quickLinks: [
      { id: "book-priest-astrologer", title: "Book Priest or Astrologer" },
      { id: "todays-temple-timings", title: "Today's Temple Timings" },
      { id: "suggested-temple-visits", title: "Suggested Temple Visits" },
      { id: "general-dos-donts", title: "General Dos and Donts" },
    ],
    recommendedRituals: ["Lakshmi Puja on Fridays", "Chant the Vishnu Sahasranama"],
  });
});

export const dosAndDontsHandler = catchAsync(async (_req: Request, res: Response) => {
  res.json(dosAndDonts);
});

// TODO(next phase): back with real temple/event data source instead of static seed content
export const nearbyAlerts = catchAsync(async (_req: Request, res: Response) => {
  res.json([{ id: "alert-1", templeName: "Hanuman Temple", eventName: "Ongoing Puja", distanceKm: 1.2 }]);
});

export const nearbyEvents = catchAsync(async (_req: Request, res: Response) => {
  res.json([{ id: "event-1", templeName: "Shiva Temple", eventName: "Monthly Abhishekam", date: "2026-07-28" }]);
});
