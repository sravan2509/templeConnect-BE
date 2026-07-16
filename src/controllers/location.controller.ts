import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { geocodePlace } from "../services/geocode.service";
import { searchTemples } from "../services/temple.service";

const geocodeSchema = z.object({ place: z.string().min(1) });
const templeSearchSchema = z.object({ query: z.string().min(1) });

export const geocode = catchAsync(async (req: Request, res: Response) => {
  const { place } = geocodeSchema.parse(req.query);
  const result = await geocodePlace(place);
  res.json(result);
});

export const findTemples = catchAsync(async (req: Request, res: Response) => {
  const { query } = templeSearchSchema.parse(req.query);
  const results = await searchTemples(query);
  res.json(results);
});
