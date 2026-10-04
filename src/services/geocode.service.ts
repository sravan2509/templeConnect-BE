import { AppError } from "../utils/AppError";
import { nominatimGet } from "./location.service";

export interface GeoLocation {
  lat: number;
  lon: number;
  displayName: string;
}

const cache = new Map<string, GeoLocation>();

export async function geocodePlace(query: string): Promise<GeoLocation> {
  if (!query || typeof query !== "string") throw new AppError("Query must be a non-empty string", 400);

  const key = query.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  let data: any;
  try {
    data = await nominatimGet({ q: query, format: "json", limit: 1 });
  } catch {
    throw new AppError("Location service is unavailable right now. Please try again shortly.", 503);
  }
  if (!Array.isArray(data) || data.length === 0) throw new AppError(`No location found for "${query}"`, 404);

  const [result] = data;
  const geo: GeoLocation = { lat: parseFloat(result.lat), lon: parseFloat(result.lon), displayName: result.display_name };
  cache.set(key, geo);
  return geo;
}

export async function autocompleteCityNames(place: string) {
  try {
    const data = await nominatimGet({ q: place, format: "json", limit: 5, addressdetails: 0 });
    return (data ?? []).map((d: any) => ({ label: d.display_name, lat: parseFloat(d.lat), lon: parseFloat(d.lon) }));
  } catch {
    throw new AppError("Location service is unavailable right now. Please try again shortly.", 503);
  }
}
