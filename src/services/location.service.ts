import axios from "axios";
import { env } from "../config/env";
import { getDistrictsByState } from "india-states-districts";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const HEADERS = { "User-Agent": env.nominatimUserAgent };
const cache = new Map<string, any>();

export interface AreaCoordinates {
  lat: number;
  lng: number;
  displayName: string;
  bbox: { south: number; north: number; west: number; east: number } | null;
}

export async function getDistricts(stateName: string): Promise<string[]> {
  try {
    const districts = getDistrictsByState(stateName);
    if (districts && districts.length > 0) {
      return [...districts].sort((a: string, b: string) => a.localeCompare(b));
    }
  } catch (err: any) {
    console.error("india-states-districts error:", err.message);
  }
  return [];
}

export async function getMandals(stateName: string, districtName: string): Promise<string[]> {
  const cacheKey = `mandals:${stateName}:${districtName}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const coords = await getAreaCoordinates(stateName, districtName);
  if (!coords?.bbox) return [];

  const { south, west, north, east } = coords.bbox;
  const query = `[out:json][timeout:30];rel["admin_level"~"6|7"](${south},${west},${north},${east});out tags;`;

  let names: string[] = [];
  let retries = 3;
  while (retries > 0) {
    try {
      const res = await axios.get(OVERPASS_URL, {
        params: { data: query },
        headers: HEADERS,
        timeout: 30000,
      });
      names = (res.data?.elements ?? [])
        .map((el: any) => el.tags?.name)
        .filter(Boolean);
      names = [...new Set(names)].sort((a: string, b: string) => a.localeCompare(b));
      break;
    } catch (err: any) {
      retries--;
      if (retries === 0) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  cache.set(cacheKey, names);
  return names;
}

export async function getAreaCoordinates(
  stateName: string,
  districtName?: string,
  mandalName?: string
): Promise<AreaCoordinates | null> {
  const parts = [mandalName, districtName, stateName, "India"].filter(Boolean) as string[];
  const locationStr = parts.join(", ");
  const cacheKey = `coords:${locationStr}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  try {
    const res = await axios.get(`${env.nominatimBaseUrl}/search`, {
      params: { q: locationStr, format: "json", limit: 1 },
      headers: { "User-Agent": env.nominatimUserAgent },
      timeout: 10000,
    });

    if (!res.data?.length) return null;

    const r = res.data[0];
    const result: AreaCoordinates = {
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      displayName: r.display_name,
      bbox: r.boundingbox
        ? {
          south: parseFloat(r.boundingbox[0]),
          north: parseFloat(r.boundingbox[1]),
          west: parseFloat(r.boundingbox[2]),
          east: parseFloat(r.boundingbox[3]),
        }
        : null,
    };

    cache.set(cacheKey, result);
    return result;
  } catch (err: any) {
    console.error("Nominatim geocode error:", err.message);
    return null;
  }
}
