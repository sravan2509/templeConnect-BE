import axios from "axios";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

export interface GeoLocation {
  lat: number;
  lon: number;
  displayName: string;
}

const cache = new Map<string, GeoLocation>();

export async function geocodePlace(query: string): Promise<GeoLocation> {
  if (!query || typeof query !== "string") {
    throw new AppError("Query must be a non-empty string", 400);
  }

  const key = query.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  const { data } = await axios.get(`${env.nominatimBaseUrl}/search`, {
    params: { q: query, format: "json", limit: 1 },
    headers: { "User-Agent": env.nominatimUserAgent },
    timeout: 10000,
  });

  if (!Array.isArray(data) || data.length === 0) {
    throw new AppError(`No location found for "${query}"`, 404);
  }

  const [result] = data;
  const geo: GeoLocation = {
    lat: parseFloat(result.lat),
    lon: parseFloat(result.lon),
    displayName: result.display_name,
  };

  cache.set(key, geo);
  return geo;
}
