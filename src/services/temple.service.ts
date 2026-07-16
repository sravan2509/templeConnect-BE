import axios from "axios";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

export interface TempleResult {
  name: string;
  rating: number | null;
  address: string | null;
  placeId: string;
  location: { lat: number; lon: number } | null;
}

export async function searchTemples(query: string): Promise<TempleResult[]> {
  if (!env.googlePlacesApiKey) {
    throw new AppError("Google Places API key is not configured", 500);
  }

  const { data } = await axios.get(
    "https://maps.googleapis.com/maps/api/place/textsearch/json",
    {
      params: { query, key: env.googlePlacesApiKey },
    }
  );

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new AppError(`Google Places error: ${data.status}`, 502);
  }

  return (data.results ?? []).map((place: Record<string, unknown>) => {
    const geometry = place.geometry as { location?: { lat: number; lng: number } } | undefined;
    return {
      name: place.name as string,
      rating: (place.rating as number) ?? null,
      address: (place.formatted_address as string) ?? null,
      placeId: place.place_id as string,
      location: geometry?.location
        ? { lat: geometry.location.lat, lon: geometry.location.lng }
        : null,
    };
  });
}
