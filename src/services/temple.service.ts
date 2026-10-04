import axios from "axios";
import { env } from "../config/env";
import { DEITY_SEARCH_KEYWORDS, getSearchKeywords } from "../data/deityTempleKeywords";
import { FAMOUS_TEMPLES, FamousTemple } from "../data/famousTemples";
import { haversineDistance } from "../utils/haversine";
import { getAreaCoordinates, nominatimGet } from "./location.service";
import { prisma } from "../config/prisma";
import { googleTextSearch, googleNearbySearch, isGoogleEnabled } from "./google.service";
import { hasRecentSearch, recordSearch, saveGoogleTemples } from "./templeStore.service";
import { isCurated, nameCoversQuery, nameTokens } from "./templeMatcher.service";

export interface TempleResult {
  name: string;
  rating: number | null;
  address: string | null;
  placeId: string;
  location: { lat: number; lon: number } | null;
  distanceKm?: number;
  city?: string;
  state?: string;
  deity?: string | null;
  curated?: boolean;
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
/** Below this many DB/dataset matches, an external search is made (once per query). */
const MIN_LOCAL_RESULTS = 5;

// ── Cache (bounded, with TTL; cleared whenever admins change temple data) ──
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 500;
const templeCache = new Map<string, { at: number; value: TempleResult[] }>();

function cacheGet(key: string) {
  const hit = templeCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) { templeCache.delete(key); return undefined; }
  return hit.value;
}
function cacheSet(key: string, value: TempleResult[]) {
  if (templeCache.size >= CACHE_MAX) templeCache.delete(templeCache.keys().next().value as string);
  templeCache.set(key, { at: Date.now(), value });
}
export function clearTempleCache() {
  templeCache.clear();
}

let lastOverpassCall = 0;
async function throttledOverpass(query: string): Promise<any> {
  const wait = Math.max(0, 3000 - (Date.now() - lastOverpassCall));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastOverpassCall = Date.now();
  const res = await axios.get(OVERPASS_URL, { params: { data: query }, headers: { "User-Agent": env.nominatimUserAgent }, timeout: 60000 });
  return res.data;
}

// ── Famous temples dataset ──

function famousToResult(t: FamousTemple, deity: string): TempleResult {
  return {
    name: t.name, rating: null, address: `${t.city}, ${t.state}`, placeId: `famous:${t.name}`,
    location: { lat: t.lat, lon: t.lng }, city: t.city, state: t.state, deity, curated: false,
  };
}

export function getAllFamousTemples(): TempleResult[] {
  const seen = new Set<string>();
  const results: TempleResult[] = [];
  for (const [deity, temples] of Object.entries(FAMOUS_TEMPLES)) {
    for (const t of temples) {
      if (!seen.has(t.name)) { seen.add(t.name); results.push(famousToResult(t, deity)); }
    }
  }
  return results;
}

/** Looks up a famous temple (by "famous:<name>" placeId or plain name). */
export function findFamousTemple(placeIdOrName: string): TempleResult | null {
  const name = placeIdOrName.replace(/^famous:/, "").toLowerCase();
  return getAllFamousTemples().find((t) => t.name.toLowerCase() === name) ?? null;
}

function getFamousTemplesForDeity(deity: string, state?: string): TempleResult[] {
  const temples = (FAMOUS_TEMPLES[deity] || []).map((t) => famousToResult(t, deity));
  if (!state) return temples;
  const inState = temples.filter((t) => t.state?.toLowerCase() === state.toLowerCase());
  return inState.length > 0 ? inState : temples;
}

/** Detects a deity mentioned in free text, e.g. "shiva temples in hyderabad" → "Shiva". */
export function detectDeity(text: string): string | null {
  const q = ` ${text.toLowerCase()} `;
  for (const [deity, keywords] of Object.entries(DEITY_SEARCH_KEYWORDS)) {
    if (keywords.some((kw) => kw.length >= 3 && new RegExp(`\\b${kw.toLowerCase()}\\b`).test(q))) return deity;
  }
  return null;
}

// ── DB temples ──

type DbTemple = Awaited<ReturnType<typeof prisma.temple.findMany>>[number];

function dbToResult(t: DbTemple): TempleResult {
  return {
    name: t.name,
    rating: t.rating ?? null,
    address: t.address || [t.city, t.state].filter(Boolean).join(", ") || null,
    placeId: t.placeId,
    location: t.lat != null && t.lon != null ? { lat: t.lat, lon: t.lon } : null,
    city: t.city || undefined,
    state: t.state || undefined,
    deity: t.deityName,
    curated: isCurated(t.source),
  };
}

function dedupe(results: TempleResult[]): TempleResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.name.toLowerCase()}|${(r.city || "").toLowerCase()}`;
    const byId = r.placeId;
    if (seen.has(key) || seen.has(byId)) return false;
    seen.add(key); seen.add(byId);
    return true;
  });
}

// ── Text search ──

export async function searchTemples(query: string): Promise<TempleResult[]> {
  const q = query.toLowerCase().trim();
  const cacheKey = `text:${q}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const deity = detectDeity(q);
  const deityKeywords = deity ? getSearchKeywords(deity).map((k) => k.toLowerCase()) : [];
  // Words left after removing the deity name and filler, used as a location filter.
  const placeWords = q.split(/[\s,]+/).filter((w) => w.length > 2 && !["temple", "temples", "mandir", "near", "the", "and", "in", "of"].includes(w) && !deityKeywords.includes(w));

  // Remaining words may name the place or the temple itself ("chilkur balaji" → Chilkur Balaji Temple).
  const matchesPlace = (r: TempleResult) =>
    placeWords.length === 0 ||
    placeWords.some((w) => [r.city, r.state, r.address, r.name].some((field) => (field || "").toLowerCase().includes(w)));

  // 1. Curated / previously-stored temples in our DB.
  const dbTemples = await prisma.temple.findMany({
    where: {
      OR: [
        { name: { contains: q } }, { city: { contains: q } }, { state: { contains: q } }, { deityName: { contains: q } },
        ...(deity ? [{ deityName: { contains: deity } }] : []),
        ...placeWords.flatMap((w) => [{ name: { contains: w } }, { city: { contains: w } }]),
      ],
    },
    orderBy: { name: "asc" },
    take: 50,
  });
  let results = dbTemples.map(dbToResult).filter((r) => {
    if (!deity) return true;
    const deityMatch = (r.deity || "").toLowerCase().includes(deity.toLowerCase()) || deityKeywords.some((k) => r.name.toLowerCase().includes(k));
    return deityMatch && matchesPlace(r);
  });

  // 2. Famous temples dataset.
  const famous = deity
    ? getFamousTemplesForDeity(deity).filter(matchesPlace)
    : getAllFamousTemples().filter((t) => {
        if (t.name.toLowerCase().includes(q) || (t.city || "").toLowerCase().includes(q) || (t.state || "").toLowerCase().includes(q)) return true;
        // Match on distinguishing words only — generic words like "temple" or "sri" would match everything.
        const words = [...nameTokens(q)].filter((w) => w.length > 2);
        const nameWords = nameTokens(t.name);
        return words.length > 0 && words.every((w) => nameWords.has(w) || (t.city || "").toLowerCase() === w || (t.state || "").toLowerCase().includes(w));
      });
  results = dedupe([...results.sort((a, b) => Number(b.curated) - Number(a.curated)), ...famous]);

  // 3. Google Places — only when the DB has few matches and this query hasn't been sent to Google
  //    recently. Results are saved to the DB, so the next identical search needs no API call.
  const googleKey = `google:text:${q}`;
  // A stored temple whose name contains every word of the query means the user found what they asked for.
  const exactHit = results.some((r) => nameCoversQuery(r.name, query));
  if (!exactHit && results.length < MIN_LOCAL_RESULTS && isGoogleEnabled() && !(await hasRecentSearch(googleKey))) {
    try {
      // Google returns loosely related places even for typos or gibberish; keep (and save) only
      // results whose name or address actually contains a distinguishing word from the query.
      const queryWords = [...nameTokens(query)].filter((w) => w.length > 2);
      const relevant = (await googleTextSearch(query)).filter((g) => {
        const haystack = [...nameTokens(`${g.name} ${g.address ?? ""}`)].join(" ");
        return queryWords.some((w) => haystack.includes(w));
      });
      const saved = await saveGoogleTemples(relevant);
      await recordSearch(googleKey, "google", saved.length);
      results = dedupe([...results, ...saved.map(dbToResult)]);
    } catch (err: any) {
      console.error("Google search failed:", err.message);
    }
  }

  // 4. OpenStreetMap (Nominatim) as a last resort.
  if (results.length === 0) {
    try {
      const data = await nominatimGet({ q: `${query} temple`, format: "json", limit: 15, countrycodes: "in" });
      results = (data ?? [])
        .filter((r: any) => {
          const name = (r.display_name || "").toLowerCase();
          return name.includes("temple") || name.includes("mandir") || name.includes("koil") || r.type === "place_of_worship";
        })
        .map((r: any) => ({
          name: r.display_name?.split(",")[0]?.trim() || "Temple",
          rating: null,
          address: r.display_name || null,
          placeId: `osm:${r.osm_type || "node"}-${r.osm_id || r.place_id}`,
          location: r.lat && r.lon ? { lat: parseFloat(r.lat), lon: parseFloat(r.lon) } : null,
          deity, curated: false,
        }));
    } catch (err: any) {
      console.error("Nominatim fallback failed:", err.message);
    }
  }

  results = results.slice(0, 30);
  cacheSet(cacheKey, results);
  return results;
}

// ── Deity + area search ──

export interface TempleSearchByDeityInput {
  deity: string;
  searchState?: string;
  searchDistrict?: string;
  searchMandal?: string;
}

export async function findTemplesByDeity(input: TempleSearchByDeityInput): Promise<TempleResult[]> {
  const { deity, searchState, searchDistrict, searchMandal } = input;
  const cacheKey = `deity:${deity}:${searchState || ""}:${searchDistrict || ""}:${searchMandal || ""}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const dbTemples = (await prisma.temple.findMany({
    where: { deityName: { contains: deity }, ...(searchState ? { state: { contains: searchState } } : {}) },
    take: 30,
  })).map(dbToResult);

  let results = dedupe([...dbTemples, ...getFamousTemplesForDeity(deity, searchState)]);

  if (searchState && (searchDistrict || searchMandal)) {
    try {
      const coords = await getAreaCoordinates(searchState, searchDistrict, searchMandal);
      if (coords?.bbox) {
        const { south, west, north, east } = coords.bbox;
        const nameFilter = getSearchKeywords(deity).slice(0, 6).map((k) => k.replace(/[^A-Za-z ]/g, "")).join("|");
        const query = `[out:json][timeout:30];node["amenity"="place_of_worship"]["religion"="hindu"]["name"~"${nameFilter}",i](${south},${west},${north},${east});out 20;`;
        const data = await throttledOverpass(query);
        const osm: TempleResult[] = (data?.elements ?? []).map((el: any) => ({
          name: el.tags?.name || `${deity} Temple`, rating: null,
          address: [el.tags?.["addr:city"] || searchDistrict, searchState].filter(Boolean).join(", "),
          placeId: `osm:${el.type}-${el.id}`, location: el.lat && el.lon ? { lat: el.lat, lon: el.lon } : null,
          state: searchState, deity, curated: false,
        }));
        results = dedupe([...osm, ...results]);
      }
    } catch (err: any) {
      console.error("Overpass failed:", err.message);
    }
  }

  cacheSet(cacheKey, results);
  return results;
}

// ── Nearby ──

export async function findTemplesNearby(lat: number, lng: number, deity?: string, radiusKm = 50): Promise<TempleResult[]> {
  const cacheKey = `near:${lat.toFixed(2)}:${lng.toFixed(2)}:${deity || ""}:${radiusKm}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let candidates: TempleResult[] = [];

  // Google Nearby Search fills in local temples the DB doesn't know yet. It's skipped for wide
  // "browse" searches, when the DB already has enough temples here, or when this area was fetched recently.
  // Results are saved, so the next visit to this area is served from the DB.
  const areaKey = `google:near:${lat.toFixed(2)}:${lng.toFixed(2)}:${deity || ""}`;
  if (isGoogleEnabled() && radiusKm <= 100 && !(await hasRecentSearch(areaKey))) {
    const localCount = (await prisma.temple.findMany({
      where: { lat: { gte: lat - 0.5, lte: lat + 0.5 }, lon: { gte: lng - 0.5, lte: lng + 0.5 }, ...(deity ? { deityName: { contains: deity } } : {}) },
      select: { lat: true, lon: true },
    })).filter((t) => haversineDistance(lat, lng, t.lat!, t.lon!) <= radiusKm).length;
    if (localCount < MIN_LOCAL_RESULTS * 2) {
      try {
        const keyword = deity ? getSearchKeywords(deity)[0] : undefined;
        const google = await googleNearbySearch(lat, lng, Math.min(radiusKm, 50) * 1000, keyword);
        const saved = await saveGoogleTemples(google);
        await recordSearch(areaKey, "google", saved.length);
      } catch (err: any) {
        console.error("Google nearby failed:", err.message);
      }
    }
  }

  const dbTemples = await prisma.temple.findMany({
    where: { lat: { not: null }, lon: { not: null }, ...(deity ? { deityName: { contains: deity } } : {}) },
    take: 500,
  });
  candidates.push(...dbTemples.map(dbToResult));
  candidates.push(...(deity ? getFamousTemplesForDeity(deity) : getAllFamousTemples()));

  const results = dedupe(candidates)
    .filter((t) => t.location)
    .map((t) => ({ ...t, distanceKm: Math.round(haversineDistance(lat, lng, t.location!.lat, t.location!.lon) * 10) / 10 }))
    .filter((t) => t.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 20);

  cacheSet(cacheKey, results);
  return results;
}
