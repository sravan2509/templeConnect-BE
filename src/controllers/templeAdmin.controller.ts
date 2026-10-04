import { Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { clearTempleCache } from "../services/temple.service";
import { isCurated } from "../services/templeMatcher.service";

const eventSchema = z.object({
  name: z.string().trim().min(1, "Event name is required").max(200),
  description: z.string().trim().max(2000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Event date must be YYYY-MM-DD"),
  time: z.string().trim().max(50).optional(),
}).strict();

const templePujaSchema = z.object({
  name: z.string().trim().min(1, "Puja name is required").max(200),
  description: z.string().trim().max(2000).optional(),
  schedule: z.string().trim().max(200).optional(),
  time: z.string().trim().max(50).optional(),
}).strict();

const withChildren = { events: { orderBy: { date: "asc" as const } }, templePujas: { orderBy: { name: "asc" as const } } };

async function templeOr404(id: string) {
  const temple = await prisma.temple.findUnique({ where: { id } });
  if (!temple) throw new AppError("Temple not found", 404);
  return temple;
}

export const addTempleEvent = catchAsync(async (req: AuthRequest, res: Response) => {
  const temple = await templeOr404(req.params.id);
  const data = eventSchema.parse(req.body);
  await prisma.$transaction([
    prisma.templeEvent.create({ data: { templeId: temple.id, ...data } }),
    prisma.temple.update({ where: { id: temple.id }, data: { source: isCurated(temple.source) ? temple.source : "admin" } }),
  ]);
  clearTempleCache();
  res.status(201).json(await prisma.temple.findUnique({ where: { id: temple.id }, include: withChildren }));
});

export const addTemplePuja = catchAsync(async (req: AuthRequest, res: Response) => {
  const temple = await templeOr404(req.params.id);
  const data = templePujaSchema.parse(req.body);
  await prisma.$transaction([
    prisma.templePuja.create({ data: { templeId: temple.id, ...data } }),
    prisma.temple.update({ where: { id: temple.id }, data: { source: isCurated(temple.source) ? temple.source : "admin" } }),
  ]);
  clearTempleCache();
  res.status(201).json(await prisma.temple.findUnique({ where: { id: temple.id }, include: withChildren }));
});

export const deleteTempleEvent = catchAsync(async (req: AuthRequest, res: Response) => {
  const result = await prisma.templeEvent.deleteMany({ where: { id: req.params.eventId, templeId: req.params.id } });
  if (result.count === 0) throw new AppError("Event not found", 404);
  clearTempleCache();
  res.status(204).send();
});

export const deleteTemplePuja = catchAsync(async (req: AuthRequest, res: Response) => {
  const result = await prisma.templePuja.deleteMany({ where: { id: req.params.pujaId, templeId: req.params.id } });
  if (result.count === 0) throw new AppError("Puja not found", 404);
  clearTempleCache();
  res.status(204).send();
});
