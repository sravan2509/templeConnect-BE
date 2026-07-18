import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { prisma } from "../config/prisma";

export const dashboard = catchAsync(async (_req: Request, res: Response) => {
  const templeCount = await prisma.bookmark.count().catch(() => 0);
  const priestCount = await prisma.priest.count().catch(() => 0);

  res.json({
    greeting: "Namaste",
    stats: { temples: templeCount, priests: priestCount },
    quickLinks: [
      { id: "find-temples", title: "Find Temples", icon: "🛕" },
      { id: "book-priest", title: "Book Priest", icon: "🧑‍🦱" },
      { id: "astrology-profile", title: "Astrology Profile", icon: "🪐" },
      { id: "dos-donts", title: "Temple Guidelines", icon: "📋" },
    ],
  });
});

export const dosAndDontsHandler = catchAsync(async (_req: Request, res: Response) => {
  res.json([
    "Remove footwear before entering the temple premises.",
    "Dress modestly — cover shoulders and knees.",
    "Switch off or silence your phone inside the sanctum.",
    "Avoid turning your back to the deity when leaving.",
    "Do not touch idols unless permitted by temple priests.",
    "Maintain silence inside the sanctum sanctorum.",
    "Follow the queue system and respect the priests.",
    "Do not carry leather items inside the temple.",
  ]);
});

export const nearbyAlerts = catchAsync(async (_req: Request, res: Response) => {
  res.json({
    message: "Nearby temple alerts feature coming soon. Enter your location for localized alerts.",
  });
});

export const nearbyEvents = catchAsync(async (_req: Request, res: Response) => {
  res.json({
    message: "Nearby temple events feature coming soon. Browse events from our temple database.",
  });
});
