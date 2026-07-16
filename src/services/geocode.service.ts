import axios from "axios";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

export interface GeoLocation {
  lat: number;
  lon: number;
  displayName: string;
}

export async function geocodePlace(query: string): Promise<GeoLocation> {
  const { data } = await axios.get(`${env.nominatimBaseUrl}/search`, {
    params: { q: query, format: "json", limit: 1 },
    headers: { "User-Agent": env.nominatimUserAgent },
  });

  if (!Array.isArray(data) || data.length === 0) {
    throw new AppError(`No location found for "${query}"`, 404);
  }

  const [result] = data;
  return {
    lat: parseFloat(result.lat),
    lon: parseFloat(result.lon),
    displayName: result.display_name,
  };
}
