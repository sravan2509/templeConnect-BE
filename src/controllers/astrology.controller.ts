import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { calculateAstroProfile, AstroProfile } from "../services/astrology.service";
import { getDeityRecommendation } from "../services/deity.service";
import { geocodePlace } from "../services/geocode.service";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middleware/auth";
import { forecastByRashi, getRecommendationsFor } from "../data/mockStore";

const birthChartSchema = z.object({
  dob: z.string().min(1),
  time: z.string().min(1),
  place: z.string().min(1),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

const completeProfileSchema = z.object({
  birthDate: z.string().min(1),
  birthTime: z.string().min(1),
  birthLocationName: z.string().min(1),
  birthLat: z.number(),
  birthLng: z.number(),
});

export const createBirthChart = catchAsync(async (req: AuthRequest, res: Response) => {
  const { dob, time, place, lat: inputLat, lng: inputLng } = birthChartSchema.parse(req.body);

  const lat = inputLat ?? (await geocodePlace(place)).lat;
  const lng = inputLng ?? (await geocodePlace(place)).lon;
  const location = await geocodePlace(place);

  const profile = calculateAstroProfile(dob, time, lat, lng);

  const saved = await prisma.birthChart.upsert({
    where: { userId: req.userId! },
    create: {
      userId: req.userId!,
      dob,
      time,
      placeName: location.displayName,
      lat,
      lon: lng,
      nakshatra: profile.nakshatra.name,
      rashi: profile.rashi.name,
    },
    update: {
      dob,
      time,
      placeName: location.displayName,
      lat,
      lon: lng,
      nakshatra: profile.nakshatra.name,
      rashi: profile.rashi.name,
    },
  });

  res.status(201).json({
    ...saved,
    profile,
    deityRecommendation: getDeityRecommendation(profile.nakshatra, profile.rashi),
  });
});

export const getBirthChart = catchAsync(async (req: AuthRequest, res: Response) => {
  const chart = await prisma.birthChart.findUnique({ where: { userId: req.userId! } });
  res.json(chart);
});

export const getAstroProfile = catchAsync(async (req: AuthRequest, res: Response) => {
  const chart = await prisma.birthChart.findUnique({ where: { userId: req.userId! } });
  if (!chart) return res.status(404).json({ error: "No birth chart found. Please create one first." });

  const profile = calculateAstroProfile(chart.dob, chart.time, chart.lat, chart.lon);
  const deityRec = getDeityRecommendation(profile.nakshatra, profile.rashi);

  res.json({
    birthDetails: { date: chart.dob, time: chart.time, place: chart.placeName, lat: chart.lat, lng: chart.lon },
    rashi: profile.rashi,
    nakshatra: profile.nakshatra,
    moonLongitude: profile.moonLongitude,
    deityRecommendation: deityRec,
  });
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

export const completeRecommendation = catchAsync(async (req: Request, res: Response) => {
  const { birthDate, birthTime, birthLocationName, birthLat, birthLng } = completeProfileSchema.parse(req.body);

  const profile = calculateAstroProfile(birthDate, birthTime, birthLat, birthLng);
  const deityRec = getDeityRecommendation(profile.nakshatra, profile.rashi);

  res.json({
    success: true,
    data: {
      birthDetails: {
        date: birthDate,
        time: birthTime,
        location: birthLocationName,
        coordinates: { lat: birthLat, lng: birthLng },
      },
      rashi: profile.rashi,
      nakshatra: profile.nakshatra,
      moonLongitude: profile.moonLongitude,
      deityRecommendation: deityRec,
    },
  });
});

