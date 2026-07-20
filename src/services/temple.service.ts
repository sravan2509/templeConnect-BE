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

let lastOverpassCall = 0;
const OVERPASS_DELAY = 3000;

async function throttledOverpass(query: string): Promise<any> {
  const now = Date.now();
  const wait = Math.max(0, OVERPASS_DELAY - (now - lastOverpassCall));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastOverpassCall = Date.now();

  const res = await axios.get(OVERPASS_URL, {
    params: { data: query },
    headers: HEADERS,
    timeout: 60000,
  });
  return res.data;
}

export async function searchTemples(query: string): Promise<TempleResult[]> {
  const cacheKey = `text:${query.toLowerCase().trim()}`;
  if (templeCache.has(cacheKey)) return templeCache.get(cacheKey)!;

  const q = query.toLowerCase();
  const allTemples = getAllFamousTemples();

  const directMatches = allTemples.filter((t) => {
    const name = t.name.toLowerCase();
    const city = (t.city || "").toLowerCase();
    const state = (t.state || "").toLowerCase();
    return name.includes(q) || city.includes(q) || state.includes(q) ||
      q.split(" ").some((word) => word.length > 2 && (name.includes(word) || city.includes(word)));
  });

  if (directMatches.length > 0) {
    directMatches.sort((a, b) => {
      const aExact = a.name.toLowerCase() === q || a.city?.toLowerCase() === q;
      const bExact = b.name.toLowerCase() === q || b.city?.toLowerCase() === q;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.name.length - b.name.length;
    });
    templeCache.set(cacheKey, directMatches.slice(0, 20));
    return directMatches.slice(0, 20);
  }

  for (const [deity, temples] of Object.entries(FAMOUS_TEMPLES)) {
    for (const kw of getSearchKeywords(deity)) {
      if (q.includes(kw.toLowerCase()) && kw.length > 3) {
        const results = getFamousTemplesForDeity(deity).slice(0, 8);
        templeCache.set(cacheKey, results);
        return results;
      }
    }
  }

  try {
    const { data } = await axios.get(`${env.nominatimBaseUrl}/search`, {
      params: { q: query + " temple", format: "json", limit: 15 },
      headers: { "User-Agent": env.nominatimUserAgent },
      timeout: 10000,
    });
    const nominatimResults: TempleResult[] = (data ?? [])
      .filter((r: any) => {
        const name = (r.display_name || "").toLowerCase();
        return name.includes("temple") || name.includes("mandir") || name.includes("koil") ||
          r.type === "place_of_worship";
      })
      .map((r: any) => ({
        name: r.display_name?.split(",")[0]?.trim() || "Temple",
        rating: null,
        address: r.display_name || null,
        placeId: `nom:${r.osm_id || r.place_id}`,
        location: r.lat && r.lon ? { lat: parseFloat(r.lat), lon: parseFloat(r.lon) } : null,
      }));
    if (nominatimResults.length > 0) {
      templeCache.set(cacheKey, nominatimResults);
      return nominatimResults;
    }
  } catch (err: any) {
    console.error("Nominatim fallback:", err.message);
  }

  const fallback = allTemples.slice(0, 8);
  templeCache.set(cacheKey, fallback);
  return fallback;
}

export interface TempleSearchByDeityInput {
  deity: string;
  searchState: string;
  searchDistrict?: string;
  searchMandal?: string;
}

export async function findTemplesByDeity(input: TempleSearchByDeityInput): Promise<TempleResult[]> {
  const { deity, searchState, searchDistrict, searchMandal } = input;

  const cacheKey = `deity:${deity}:${searchState}:${searchDistrict || ""}:${searchMandal || ""}`;
  if (templeCache.has(cacheKey)) return templeCache.get(cacheKey)!;

  const famousResults = getFamousTemplesForDeity(deity, searchState);
  if (famousResults.length > 0) {
    templeCache.set(cacheKey, famousResults);
    return famousResults;
  }

  try {
    const coords = await getAreaCoordinates(searchState, searchDistrict, searchMandal);
    if (coords?.bbox) {
      const { south, west, north, east } = coords.bbox;
      const keywords = getSearchKeywords(deity).slice(0, 3);

      const nameFilters = keywords
        .map((kw) => `["name"~"${kw.replace(/"/g, '\\"')}",i]`)
        .join("");

      const query = `[out:json][timeout:30];(node["amenity"="place_of_worship"]["religion"="hindu"]${nameFilters}(${south},${west},${north},${east}););out center 15;`;

      const data = await throttledOverpass(query);
      const elements = data?.elements ?? [];
      if (elements.length > 0) {
        const results: TempleResult[] = elements.map((el: any) => ({
          name: el.tags?.name || `${deity} Temple`,
          rating: null,
          address: el.tags?.["addr:city"] || searchDistrict || searchState,
          placeId: `osm:${el.type}/${el.id}`,
          location: el.lat && el.lon ? { lat: el.lat, lon: el.lon } : null,
          state: el.tags?.["addr:state"] || searchState,
        }));
        templeCache.set(cacheKey, results);
        return results;
      }
    }
  } catch (err: any) {
    console.error("Overpass failed:", err.message);
  }

  const allForDeity = getAllFamousTemples().filter((t) => {
    const allKeywords = getSearchKeywords(deity).map((k) => k.toLowerCase());
    return allKeywords.some((kw) => t.name.toLowerCase().includes(kw));
  }).slice(0, 15);

  templeCache.set(cacheKey, allForDeity);
  return allForDeity;
}

function getFamousTemplesForDeity(deity: string, state?: string): TempleResult[] {
  const temples = FAMOUS_TEMPLES[deity] || [];
  let filtered = temples;

  if (state) {
    const stateMatch = temples.filter((t) => t.state === state);
    if (stateMatch.length > 0) filtered = stateMatch;
  }

  return filtered.map((t: FamousTemple) => ({
    name: t.name,
    rating: null,
    address: `${t.city}, ${t.state}`,
    placeId: `famous:${t.name}`,
    location: { lat: t.lat, lon: t.lng },
    city: t.city,
    state: t.state,
  }));
}

function getAllFamousTemples(): TempleResult[] {
  const results: TempleResult[] = [];
  const seen = new Set<string>();
  for (const temples of Object.values(FAMOUS_TEMPLES)) {
    for (const t of temples) {
      if (!seen.has(t.name)) {
        seen.add(t.name);
        results.push({
          name: t.name,
          rating: null,
          address: `${t.city}, ${t.state}`,
          placeId: `famous:${t.name}`,
          location: { lat: t.lat, lon: t.lng },
          city: t.city,
          state: t.state,
        });
      }
    }
  }
  return results;
}

export async function findTemplesNearby(
  lat: number,
  lng: number,
  deity?: string,
  radiusKm: number = 50
): Promise<TempleResult[]> {
  const allTemples = deity ? getFamousTemplesForDeity(deity) : getAllFamousTemples().slice(0, 30);
  const withDistance = allTemples.map((t) => ({
    ...t,
    distanceKm: t.location ? haversineDistance(lat, lng, t.location.lat, t.location.lon) : Infinity,
  }));
  return withDistance
    .filter((t) => t.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 10);
}
