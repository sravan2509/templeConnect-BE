import axios from "axios";
import { env } from "../config/env";

const BASE = "https://maps.googleapis.com/maps/api/place";

export interface GoogleTemple {
  placeId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  rating: number | null;
  reviewCount: number | null;
  phone: string | null;
  website: string | null;
  openNow: boolean | null;
  photoRef: string | null;
}

export function isGoogleEnabled(): boolean {
  return !!env.googleMapsApiKey;
}

export async function googleTextSearch(query: string): Promise<GoogleTemple[]> {
  if (!isGoogleEnabled()) return [];
  const { data } = await axios.get(`${BASE}/textsearch/json`, {
    params: { query: `${query} temple`, key: env.googleMapsApiKey },
    timeout: 10000,
  });
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Places error: ${data.status}`);
  }
  return (data.results ?? []).map(mapGoogleResult);
}

export async function googleNearbySearch(lat: number, lng: number, radiusM: number, keyword?: string): Promise<GoogleTemple[]> {
  if (!isGoogleEnabled()) return [];
  const params: any = {
    location: `${lat},${lng}`,
    radius: radiusM,
    type: "hindu_temple",
    key: env.googleMapsApiKey,
  };
  if (keyword) params.keyword = keyword;
  const { data } = await axios.get(`${BASE}/nearbysearch/json`, { params, timeout: 10000 });
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Places error: ${data.status}`);
  }
  return (data.results ?? []).map(mapGoogleResult);
}

export async function googlePlaceDetails(placeId: string): Promise<Partial<GoogleTemple> & { openingHours?: any; photos?: string[] }> {
  if (!isGoogleEnabled()) return {};
  const { data } = await axios.get(`${BASE}/details/json`, {
    params: { place_id: placeId, fields: "name,formatted_address,geometry,rating,user_ratings_total,formatted_phone_number,website,opening_hours,photos", key: env.googleMapsApiKey },
    timeout: 10000,
  });
  if (data.status !== "OK") return {};
  const r = data.result;
  return {
    name: r.name,
    address: r.formatted_address,
    lat: r.geometry?.location?.lat ?? null,
    lon: r.geometry?.location?.lng ?? null,
    rating: r.rating ?? null,
    reviewCount: r.user_ratings_total ?? null,
    phone: r.formatted_phone_number ?? null,
    website: r.website ?? null,
    openNow: r.opening_hours?.open_now ?? null,
    openingHours: r.opening_hours?.weekday_text ?? null,
    photos: (r.photos ?? []).slice(0, 3).map((p: any) => p.photo_reference),
  };
}

function mapGoogleResult(r: any): GoogleTemple {
  return {
    placeId: r.place_id,
    name: r.name,
    address: r.formatted_address ?? r.vicinity ?? null,
    lat: r.geometry?.location?.lat ?? null,
    lon: r.geometry?.location?.lng ?? null,
    rating: r.rating ?? null,
    reviewCount: r.user_ratings_total ?? null,
    phone: null,
    website: null,
    openNow: r.opening_hours?.open_now ?? null,
    photoRef: r.photos?.[0]?.photo_reference ?? null,
  };
}
