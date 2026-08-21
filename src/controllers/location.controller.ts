import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { geocodePlace } from "../services/geocode.service";
import { searchTemples } from "../services/temple.service";
import { INDIAN_STATES } from "../data/indianStates";
import { getDistricts, getMandals } from "../services/location.service";

const geocodeSchema = z.object({ place: z.string().min(1) });
const templeSearchSchema = z.object({ query: z.string().min(1) });

export const geocode = catchAsync(async (req: Request, res: Response) => {
  const { place } = geocodeSchema.parse(req.query);
  const result = await geocodePlace(place);
  res.json(result);
});

export const autocompleteCities = catchAsync(async (req: Request, res: Response) => {
  const { place } = geocodeSchema.parse(req.query);
  const axios = require("axios");
  const { env } = require("../config/env");
  const { data } = await axios.get(`${env.nominatimBaseUrl}/search`, {
    params: { q: place, format: "json", limit: 5, featuretype: "city" },
    headers: { "User-Agent": env.nominatimUserAgent },
    timeout: 10000,
  });
  const results = data.map((d: any) => ({ label: d.display_name, lat: parseFloat(d.lat), lon: parseFloat(d.lon) }));
  res.json(results);
});

export const findTemples = catchAsync(async (req: Request, res: Response) => {
  const { query } = templeSearchSchema.parse(req.query);
  const results = await searchTemples(query);
  res.json(results);
});

export const getStates = catchAsync(async (_req: Request, res: Response) => {
  res.json({ success: true, data: INDIAN_STATES });
});

export const getDistrictsHandler = catchAsync(async (req: Request, res: Response) => {
  const { state } = req.query as { state: string };
  if (!state) return res.status(400).json({ success: false, error: "Missing state parameter" });
  const districts = await getDistricts(state);
  res.json({ success: true, data: districts });
});

export const getMandalsHandler = catchAsync(async (req: Request, res: Response) => {
  const { state, district } = req.query as { state: string; district: string };
  if (!state || !district)
    return res.status(400).json({ success: false, error: "Missing state or district parameter" });
  const mandals = await getMandals(state, district);
  res.json({ success: true, data: mandals });
});
