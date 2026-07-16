import { Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { calculateBirthChart } from "../services/astrology.service";
import { geocodePlace } from "../services/geocode.service";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middleware/auth";
import { forecastByRashi, getRecommendationsFor } from "../data/mockStore";

const birthChartSchema = z.object({
  dob: z.string(),
  time: z.string(),
  place: z.string().min(1),
});

export const createBirthChart = catchAsync(async (req: AuthRequest, res: Response) => {
  const { dob, time, place } = birthChartSchema.parse(req.body);
  const location = await geocodePlace(place);
  const chart = await calculateBirthChart({ dob, time, lat: location.lat, lon: location.lon });

  const saved = await prisma.birthChart.upsert({
    where: { userId: req.userId! },
    create: {
      userId: req.userId!,
      dob,
      time,
      placeName: location.displayName,
      lat: location.lat,
      lon: location.lon,
      nakshatra: chart.nakshatra,
      rashi: chart.rashi,
    },
    update: {
      dob,
      time,
      placeName: location.displayName,
      lat: location.lat,
      lon: location.lon,
      nakshatra: chart.nakshatra,
      rashi: chart.rashi,
    },
  });

  res.status(201).json(saved);
});

export const getBirthChart = catchAsync(async (req: AuthRequest, res: Response) => {
  const chart = await prisma.birthChart.findUnique({ where: { userId: req.userId! } });
  res.json(chart);
});

export const getForecast = catchAsync(async (req: AuthRequest, res: Response) => {
  const chart = await prisma.birthChart.findUnique({ where: { userId: req.userId! } });
  const rashi = chart?.rashi ?? null;
  res.json({
    rashi,
    forecast: (rashi && forecastByRashi[rashi]) ?? "Add your birth details to get a personalized forecast.",
  });
});

export const getRecommendations = catchAsync(async (req: AuthRequest, res: Response) => {
  const chart = await prisma.birthChart.findUnique({ where: { userId: req.userId! } });
  res.json({ rashi: chart?.rashi ?? null, recommendations: getRecommendationsFor(chart?.rashi ?? null) });
});
