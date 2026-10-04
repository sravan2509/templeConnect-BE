import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { autocompleteCityNames, geocodePlace } from "../services/geocode.service";
import { searchTemples } from "../services/temple.service";
import { INDIAN_STATES } from "../data/indianStates";
import { getDistricts, getMandals } from "../services/location.service";

const geocodeSchema = z.object({ place: z.string().trim().min(2, "Enter at least 2 characters").max(200) });
const templeSearchSchema = z.object({ query: z.string().trim().min(1, "Enter a search term").max(200) });

export const geocode = catchAsync(async (req: Request, res: Response) => {
  const { place } = geocodeSchema.parse(req.query);
  res.json(await geocodePlace(place));
});

export const autocompleteCities = catchAsync(async (req: Request, res: Response) => {
  const { place } = geocodeSchema.parse(req.query);
  res.json(await autocompleteCityNames(place));
});

export const findTemples = catchAsync(async (req: Request, res: Response) => {
  const { query } = templeSearchSchema.parse(req.query);
  res.json(await searchTemples(query));
});

export const getStates = catchAsync(async (_req: Request, res: Response) => {
  res.json({ success: true, data: INDIAN_STATES });
});

export const getDistrictsHandler = catchAsync(async (req: Request, res: Response) => {
  const { state } = z.object({ state: z.string().min(1, "Missing state parameter") }).parse(req.query);
  res.json({ success: true, data: await getDistricts(state) });
});

export const getMandalsHandler = catchAsync(async (req: Request, res: Response) => {
  const { state, district } = z.object({ state: z.string().min(1), district: z.string().min(1) }).parse(req.query);
  res.json({ success: true, data: await getMandals(state, district) });
});
