import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { prisma } from "../config/prisma";
import { getAllFamousTemples } from "../services/temple.service";

export const dashboard = catchAsync(async (_req: Request, res: Response) => {
  const [curatedTemples, priestCount, pujaCount] = await Promise.all([
    prisma.temple.count({ where: { source: { in: ["upload", "import", "admin"] } } }),
    prisma.priest.count(),
    prisma.puja.count({ where: { active: true } }),
  ]);

  res.json({
    greeting: "Namaste",
    stats: { temples: curatedTemples + getAllFamousTemples().length, priests: priestCount, pujas: pujaCount },
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
