import { Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";

// ── Validation Schemas ──────────────────────────────────────

const eventSchema = z.object({
  name: z.string().min(1, "Event name is required"),
  description: z.string().optional(),
  date: z.string().min(1, "Event date is required"),
  time: z.string().optional(),
});

const templePujaSchema = z.object({
  name: z.string().min(1, "Puja name is required"),
  description: z.string().optional(),
  schedule: z.string().optional(),
  time: z.string().optional(),
});

const saveTempleEventsSchema = z.object({
  templeName: z.string().min(1, "Temple name is required"),
  placeId: z.string().min(1, "Place ID is required"),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  events: z.array(eventSchema).default([]),
  pujas: z.array(templePujaSchema).default([]),
});

// ── Save Temple with Events & Pujas ─────────────────────────

export const saveTempleEvents = catchAsync(async (req: AuthRequest, res: Response) => {
  const data = saveTempleEventsSchema.parse(req.body);

  if (data.events.length === 0 && data.pujas.length === 0) {
    throw new AppError("At least one event or puja is required", 400);
  }

  // Upsert temple by placeId
  let temple = await prisma.temple.findUnique({ where: { placeId: data.placeId } });

  if (temple) {
    // Update temple info
    temple = await prisma.temple.update({
      where: { id: temple.id },
      data: {
        name: data.templeName,
        address: data.address,
        city: data.city,
        state: data.state,
        lat: data.lat,
        lon: data.lon,
      },
    });
  } else {
    temple = await prisma.temple.create({
      data: {
        name: data.templeName,
        placeId: data.placeId,
        address: data.address,
        city: data.city,
        state: data.state,
        lat: data.lat,
        lon: data.lon,
      },
    });
  }

  // Create events
  if (data.events.length > 0) {
    for (const event of data.events) {
      await prisma.templeEvent.create({
        data: {
          templeId: temple.id,
          name: event.name,
          description: event.description,
          date: event.date,
          time: event.time,
        },
      });
    }
  }

  // Create pujas
  if (data.pujas.length > 0) {
    for (const puja of data.pujas) {
      await prisma.templePuja.create({
        data: {
          templeId: temple.id,
          name: puja.name,
          description: puja.description,
          schedule: puja.schedule,
          time: puja.time,
        },
      });
    }
  }

  // Return full temple with events and pujas
  const result = await prisma.temple.findUnique({
    where: { id: temple.id },
    include: { events: true, templePujas: true },
  });

  res.status(201).json(result);
});

// ── List All Temples with Events & Pujas ────────────────────

export const listTempleEvents = catchAsync(async (_req: AuthRequest, res: Response) => {
  const temples = await prisma.temple.findMany({
    include: {
      events: { orderBy: { date: "asc" } },
      templePujas: { orderBy: { name: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  res.json(temples);
});

// ── Get Single Temple with Events & Pujas ───────────────────

export const getTempleEvents = catchAsync(async (req: AuthRequest, res: Response) => {
  const temple = await prisma.temple.findUnique({
    where: { id: req.params.templeId },
    include: { events: true, templePujas: true },
  });

  if (!temple) throw new AppError("Temple not found", 404);
  res.json(temple);
});

// ── Delete a Temple Event ───────────────────────────────────

export const deleteTempleEvent = catchAsync(async (req: AuthRequest, res: Response) => {
  const { templeId, eventId } = req.params;

  // Verify event belongs to temple
  const event = await prisma.templeEvent.findFirst({
    where: { id: eventId, templeId },
  });
  if (!event) throw new AppError("Event not found", 404);

  await prisma.templeEvent.delete({ where: { id: eventId } });
  res.status(204).send();
});

// ── Delete a Temple Puja ────────────────────────────────────

export const deleteTemplePuja = catchAsync(async (req: AuthRequest, res: Response) => {
  const { templeId, pujaId } = req.params;

  const puja = await prisma.templePuja.findFirst({
    where: { id: pujaId, templeId },
  });
  if (!puja) throw new AppError("Puja not found", 404);

  await prisma.templePuja.delete({ where: { id: pujaId } });
  res.status(204).send();
});

// ── Delete a Temple (and all its events/pujas) ──────────────

export const deleteTemple = catchAsync(async (req: AuthRequest, res: Response) => {
  const { templeId } = req.params;

  const temple = await prisma.temple.findUnique({ where: { id: templeId } });
  if (!temple) throw new AppError("Temple not found", 404);

  await prisma.temple.delete({ where: { id: templeId } });
  res.status(204).send();
});
