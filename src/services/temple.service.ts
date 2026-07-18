import axios from "axios";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import { getSearchKeywords } from "../data/deityTempleKeywords";
import { FAMOUS_TEMPLES, FamousTemple } from "../data/famousTemples";
import { haversineDistance } from "../utils/haversine";
import { getAreaCoordinates } from "./location.service";

export interface TempleResult {
  name: string;
  rating: number | null;
  address: string | null;
  placeId: string;
  location: { lat: number; lon: number } | null;
  distanceKm?: number;
  city?: string;
  state?: string;
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const HEADERS = { "User-Agent": env.nominatimUserAgent };

const templeCache = new Map<string, TempleResult[]>();

export async function searchTemples(query: string): Promise<TempleResult[]> {
  if (!env.googlePlacesApiKey) {
    return searchTemplesOverpass(query);
  }

  try {
    const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/textsearch/json", {
      params: { query, key: env.googlePlacesApiKey },
      timeout: 10000,
    });

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      throw new AppError(`Google Places error: ${data.status}`, 502);
    }

    return (data.results ?? []).map((place: any) => {
      const geometry = place.geometry;
      return {
        name: place.name as string,
        rating: (place.rating as number) ?? null,
        address: (place.formatted_address as string) ?? null,
        placeId: place.place_id as string,
        location: geometry?.location ? { lat: geometry.location.lat, lon: geometry.location.lng } : null,
      };
    });
  } catch (err: any) {
    console.error("Google Places error, falling back to Overpass:", err.message);
    return searchTemplesOverpass(query);
  }
}

async function searchTemplesOverpass(query: string): Promise<TempleResult[]> {
  const cacheKey = `overpass:${query}`;
  if (templeCache.has(cacheKey)) return templeCache.get(cacheKey)!;

  const { data } = await axios.get(`${env.nominatimBaseUrl}/search`, {
    params: { q: query + " temple hindu", format: "json", limit: 20 },
    headers: { "User-Agent": env.nominatimUserAgent },
    timeout: 15000,
  });

  const results: TempleResult[] = (data ?? [])
    .filter((r: any) => {
      const type = r.type || "";
      const cls = r.class || "";
      return type.includes("place_of_worship") || cls.includes("amenity") || type.includes("temple");
    })
    .map((r: any) => ({
      name: r.display_name?.split(",")[0] || "Temple",
      rating: null,
      address: r.display_name || null,
      placeId: `osm:${r.osm_id || r.place_id}`,
      location: { lat: parseFloat(r.lat), lon: parseFloat(r.lon) },
    }));

  templeCache.set(cacheKey, results);
  return results;
}

export interface TempleSearchByDeityInput {
  deity: string;
  searchState: string;
  searchDistrict?: string;
  searchMandal?: string;
}

export async function findTemplesByDeity(input: TempleSearchByDeityInput): Promise<TempleResult[]> {
  const { deity, searchState, searchDistrict, searchMandal } = input;
  const keywords = getSearchKeywords(deity);

  const coords = await getAreaCoordinates(searchState, searchDistrict, searchMandal);
  if (!coords?.bbox) {
    return getFamousTemplesForDeity(deity, searchState);
  }

  const { south, west, north, east } = coords.bbox;

  const tagConditions = keywords
    .map((kw) => {
      const escaped = kw.replace(/"/g, '\\"');
      return `["name"~"${escaped}",i]`;
    })
    .join("");

  const query = `[out:json][timeout:45];(node["amenity"="place_of_worship"]["religion"="hindu"]${tagConditions}(${south},${west},${north},${east});way["amenity"="place_of_worship"]["religion"="hindu"]${tagConditions}(${south},${west},${north},${east});relation["amenity"="place_of_worship"]["religion"="hindu"]${tagConditions}(${south},${west},${north},${east}););out center 30;`;

  let osmTemples: TempleResult[] = [];
  let retries = 3;
  while (retries > 0) {
    try {
      const res = await axios.get(OVERPASS_URL, {
        params: { data: query },
        headers: HEADERS,
        timeout: 45000,
      });

      const elements = res.data?.elements ?? [];
      osmTemples = elements.map((el: any) => {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        return {
          name: el.tags?.name || `${deity} Temple`,
          rating: null,
          address: el.tags?.["addr:full"] || el.tags?.["addr:city"] || searchDistrict || searchState,
          placeId: `osm:${el.type}/${el.id}`,
          location: lat && lon ? { lat, lon } : null,
          state: el.tags?.["addr:state"] || searchState,
        };
      });
      break;
    } catch (err: any) {
      retries--;
      if (retries === 0) {
        console.error("Overpass failed:", err.message);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  if (osmTemples.length > 0) return osmTemples.slice(0, 20);

  return getFamousTemplesForDeity(deity, searchState);
}

function getFamousTemplesForDeity(deity: string, state?: string): TempleResult[] {
  const temples = FAMOUS_TEMPLES[deity] || FAMOUS_TEMPLES["Shiva"];
  let filtered = temples;

  if (state) {
    const stateMatch = temples.filter((t) => t.state === state);
    if (stateMatch.length > 0) filtered = stateMatch;
  }

  return filtered.slice(0, 20).map((t: FamousTemple) => ({
    name: t.name,
    rating: null,
    address: `${t.city}, ${t.state}`,
    placeId: `famous:${t.name}`,
    location: { lat: t.lat, lon: t.lng },
    city: t.city,
    state: t.state,
  }));
}

export async function findTemplesNearby(
  lat: number,
  lng: number,
  deity?: string,
  radiusKm: number = 50
): Promise<TempleResult[]> {
  const allTemples = deity ? await getFamousTemplesForDeity(deity) : [];

  const withDistance = allTemples.map((t) => ({
    ...t,
    distanceKm: t.location ? haversineDistance(lat, lng, t.location.lat, t.location.lon) : Infinity,
  }));

  return withDistance
    .filter((t) => t.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 10);
}
