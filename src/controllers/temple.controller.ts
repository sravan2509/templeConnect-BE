import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { geocodePlace } from "../services/geocode.service";
import { searchTemples, findTemplesByDeity, findTemplesNearby } from "../services/temple.service";
import {
  createReminder,
  deleteReminder,
  mockTempleEvents,
  mockTempleHistory,
  mockTempleTimings,
} from "../data/mockStore";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";

const templeSearchSchema = z.object({ query: z.string().min(1) });

export const findTemples = catchAsync(async (req: Request, res: Response) => {
  const { query } = templeSearchSchema.parse(req.query);
  const results = await searchTemples(query);
  res.json(results);
});

export const findTemplesByDeityHandler = catchAsync(async (req: Request, res: Response) => {
  const schema = z.object({
    deity: z.string().min(1),
    searchState: z.string().min(1),
    searchDistrict: z.string().optional(),
    searchMandal: z.string().optional(),
  });
  const input = schema.parse(req.body);
  const results = await findTemplesByDeity(input);
  res.json({ success: true, data: results });
});

export const findTemplesNearbyHandler = catchAsync(async (req: Request, res: Response) => {
  const schema = z.object({
    lat: z.coerce.number(),
    lng: z.coerce.number(),
    deity: z.string().optional(),
    radiusKm: z.coerce.number().optional().default(50),
  });
  const input = schema.parse(req.query);
  const results = await findTemplesNearby(input.lat, input.lng, input.deity, input.radiusKm);
  res.json({ success: true, data: results });
});

export const mapView = catchAsync(async (req: Request, res: Response) => {
  const { query } = templeSearchSchema.parse(req.query);
  const results = await searchTemples(query);
  res.json(results.filter((r) => r.location).map((r) => ({ name: r.name, placeId: r.placeId, location: r.location })));
});

export const getTempleDetail = catchAsync(async (req: Request, res: Response) => {
  const { placeId } = req.params;

  // Check if temple exists in DB with admin-curated data
  const dbTemple = await prisma.temple.findUnique({
    where: { placeId },
    include: { events: true, templePujas: true },
  });

  const mock = mockTempleHistory(placeId);
  const timings = mockTempleTimings(placeId);

  if (dbTemple) {
    res.json({
      placeId,
      name: dbTemple.name,
      deity: dbTemple.deityName || mock.deity || "Various",
      history: dbTemple.templeHistory || mock.history || "A renowned Hindu temple.",
      builtCentury: mock.builtCentury || "Ancient",
      significance: dbTemple.significance || null,
      sevas: dbTemple.sevas || null,
      contactDetails: dbTemple.contactDetails || null,
      websiteLink: dbTemple.websiteLink || null,
      address: dbTemple.address || null,
      city: dbTemple.city || null,
      state: dbTemple.state || null,
      lat: dbTemple.lat,
      lon: dbTemple.lon,
      timings,
      events: dbTemple.events,
      pujas: dbTemple.templePujas,
      source: "db",
    });
  } else {
    res.json({
      placeId,
      deity: mock.deity || "Various",
      history: mock.history || "A renowned Hindu temple.",
      builtCentury: mock.builtCentury || "Ancient",
      significance: null,
      sevas: null,
      contactDetails: null,
      websiteLink: null,
      timings,
      events: mockTempleEvents(placeId),
      source: "api",
    });
  }
});

export const getTempleTimings = catchAsync(async (req: Request, res: Response) => {
  res.json(mockTempleTimings(req.params.placeId));
});

export const getTempleEvents = catchAsync(async (req: Request, res: Response) => {
  const { placeId } = req.params;

  // Check DB first
  const dbTemple = await prisma.temple.findUnique({
    where: { placeId },
    include: { events: true, templePujas: true },
  });

  if (dbTemple) {
    res.json({
      source: "db",
      events: dbTemple.events,
      pujas: dbTemple.templePujas,
    });
  } else {
    res.json({
      source: "api",
      events: [],
      pujas: [],
      message: "Currently the data is not available",
    });
  }
});

export const getTempleHistory = catchAsync(async (req: Request, res: Response) => {
  res.json(mockTempleHistory(req.params.placeId));
});

export const setReminder = catchAsync(async (req: AuthRequest, res: Response) => {
  const reminder = createReminder(req.userId!, req.params.placeId);
  res.status(201).json(reminder);
});

export const removeReminder = catchAsync(async (req: Request, res: Response) => {
  const removed = deleteReminder(req.params.id);
  if (!removed) throw new AppError("Reminder not found", 404);
  res.status(204).send();
});
