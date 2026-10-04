import { Prisma, Temple } from "@prisma/client";
import { prisma } from "../config/prisma";
import { haversineDistance } from "../utils/haversine";
import { DEITY_SEARCH_KEYWORDS } from "../data/deityTempleKeywords";

/**
 * Finds the DB temple that an incoming record (Google result, uploaded row, CSV row)
 * refers to, so data is merged into one row instead of creating duplicates.
 *
 * Matching order:
 *  1. Same Google place id or same placeId.
 *  2. Within ~400 m and a similar name.
 *  3. Same city and a similar (or identical) name.
 *  4. Identical normalized name, when it is the only such temple and neither side contradicts on city.
 */

// Words that don't distinguish one temple from another.
const FILLER = new Set([
  "sri", "shri", "shree", "sree", "srii", "temple", "temples", "mandir", "mandiram", "devalayam", "devasthanam", "devasthanams",
  "alayam", "aalayam", "kovil", "koil", "gudi", "swamy", "swami", "swamivari", "the", "of", "and", "at", "lord", "maha",
  "kshetram", "kshetra", "peetham", "shrine", "dham", "math", "mutt", "ji",
]);

/** Folds common transliteration variants: Lingeshwara/Lingeswara, Venkatesvara/Venkateswara, Keesara/Kisara. */
function fold(text: string): string {
  return text.replace(/sh/g, "s").replace(/w/g, "v").replace(/ee|ii/g, "i").replace(/oo|uu/g, "u").replace(/aa/g, "a").replace(/(.)/g, "$1");
}

/** Distinguishing words of a temple name, with spelling variants folded. */
export function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !FILLER.has(t))
      .map(fold)
  );
}

/** True when every distinguishing word of `query` appears in `name` (e.g. "chilkur balaji" → "Chilkur Balaji Temple"). */
export function nameCoversQuery(name: string, query: string): boolean {
  const q = nameTokens(query);
  if (q.size === 0) return false;
  const n = nameTokens(name);
  for (const t of q) if (!n.has(t)) return false;
  return true;
}

export function normalizedName(name: string): string {
  return [...nameTokens(name)].sort().join(" ");
}

// Deity names alone (e.g. "Durga Temple") are too generic to identify a temple.
const GENERIC = new Set(Object.values(DEITY_SEARCH_KEYWORDS).flat().map((k) => k.toLowerCase()).filter((k) => !k.includes(" ")).map(fold));

/**
 * 1 = same distinguishing words; also high when one name's words are all contained in the other.
 * With `strict`, containment is ignored when the shorter name is just a generic deity word.
 */
export function nameSimilarity(a: string, b: string, strict = false): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  const shorter = ta.size <= tb.size ? ta : tb;
  const genericOnly = shorter.size === 1 && GENERIC.has([...shorter][0]);
  const containment = strict && genericOnly ? 0 : common / Math.min(ta.size, tb.size);
  const jaccard = common / (ta.size + tb.size - common);
  return Math.max(jaccard, containment * 0.9);
}

/**
 * Character-bigram (Dice) similarity of the distinguishing words joined together, after folding
 * spelling variants. Catches "Ramalingeswara" vs "Rama Lingeshwara". Only used for nearby temples,
 * because short generic names score high against each other.
 */
export function fuzzyNameSimilarity(a: string, b: string): number {
  const join = (n: string) => fold([...nameTokens(n)].sort().join(""));
  const x = join(a), y = join(b);
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const bigrams = (t: string) => { const m = new Map<string, number>(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const bx = bigrams(x), by = bigrams(y);
  let overlap = 0;
  for (const [g, c] of bx) overlap += Math.min(c, by.get(g) ?? 0);
  return (2 * overlap) / (x.length - 1 + y.length - 1);
}

const sameCity = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export interface MatchInput {
  name: string;
  city?: string | null;
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  googlePlaceId?: string | null;
  placeId?: string | null;
}

export async function findMatchingTemple(input: MatchInput, tx: Prisma.TransactionClient = prisma): Promise<Temple | null> {
  // 1. Exact ids
  if (input.googlePlaceId) {
    const byGoogle = await tx.temple.findUnique({ where: { googlePlaceId: input.googlePlaceId } });
    if (byGoogle) return byGoogle;
  }
  if (input.placeId) {
    const byPlace = await tx.temple.findUnique({ where: { placeId: input.placeId } });
    if (byPlace) return byPlace;
  }

  const best = (candidates: Temple[], minScore: number, score: (t: Temple) => number) => {
    let top: Temple | null = null;
    let topScore = minScore;
    for (const t of candidates) {
      const raw = score(t);
      if (raw < minScore) continue;
      // On a tie, prefer the admin-curated row so uploads land on the record admins maintain.
      const s = raw + (isCurated(t.source) ? 0.001 : 0);
      if (s > topScore || top === null) { top = t; topScore = s; }
    }
    return top;
  };

  // 2. Nearby with a similar name
  if (input.lat != null && input.lon != null) {
    const d = 0.01; // ~1 km box, refined by haversine below
    const nearby = await tx.temple.findMany({
      where: { lat: { gte: input.lat - d, lte: input.lat + d }, lon: { gte: input.lon - d, lte: input.lon + d } },
      take: 200,
    });
    const match = best(nearby, 0.5, (t) => {
      if (haversineDistance(input.lat!, input.lon!, t.lat!, t.lon!) > 0.4) return 0;
      return Math.max(nameSimilarity(input.name, t.name), fuzzyNameSimilarity(input.name, t.name) * 0.9);
    });
    if (match) return match;
  }

  // 3. Same city with a similar name
  const city = input.city?.trim();
  if (city) {
    const inCity = await tx.temple.findMany({ where: { city: { contains: city } }, take: 500 });
    const match = best(inCity.filter((t) => sameCity(t.city, city)), 0.6, (t) => nameSimilarity(input.name, t.name, true));
    if (match) return match;
  }

  // 4. Identical normalized name, unique, no conflicting city/location
  const key = normalizedName(input.name);
  const firstToken = key.split(" ")[0];
  if (!firstToken) return null;
  const sameWord = await tx.temple.findMany({ where: { name: { contains: firstToken } }, take: 500 });
  const mentions = (text: string | null | undefined, word: string | null | undefined) =>
    !!text && !!word && text.toLowerCase().includes(word.trim().toLowerCase());
  const identical = sameWord.filter((t) => normalizedName(t.name) === key).filter((t) => {
    // Different city names are only a conflict when neither address mentions the other's city
    // (sources name localities differently, e.g. "Chilkur" vs "Hyderabad").
    if (city && t.city && !sameCity(t.city, city) && !mentions(t.address, city) && !mentions(input.address, t.city)) return false;
    if (input.lat != null && input.lon != null && t.lat != null && t.lon != null) {
      return haversineDistance(input.lat, input.lon, t.lat, t.lon) <= 2;
    }
    // Without coordinates or city on either side we only trust the address mentioning the other's city.
    if (!city && !(input.lat != null)) return !!t.city && !!input.address?.toLowerCase().includes(t.city.toLowerCase());
    return true;
  });
  return identical.length === 1 ? identical[0] : null;
}

/** Fields where a non-empty incoming value should fill or replace the stored one. */
export type TempleFields = Partial<Pick<Temple,
  "name" | "deityName" | "address" | "city" | "state" | "lat" | "lon" | "rating" | "reviewCount" | "phone" | "website" |
  "contactDetails" | "templeHistory" | "significance" | "sevas" | "websiteLink" | "serialNumber" | "googlePlaceId" | "openingHours"
>>;

const CURATED = new Set(["upload", "import", "admin"]);
export const isCurated = (source: string) => CURATED.has(source);

/**
 * Merge rules:
 *  - Curated sources (upload/import/admin) win: their non-empty values overwrite the stored ones.
 *  - Non-curated sources (google/search) only fill fields that are still empty, so they never
 *    overwrite admin-entered data. Google-only facts (rating, reviews, phone, website, hours) are always refreshed.
 *  - Empty incoming values never erase stored data.
 */
export function mergeTempleData(existing: Temple, incoming: TempleFields, incomingSource: string): Prisma.TempleUpdateInput {
  const data: Record<string, unknown> = {};
  const curated = isCurated(incomingSource);
  const googleOwned = new Set(["rating", "reviewCount", "phone", "website", "openingHours", "googlePlaceId"]);

  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined || value === "") continue;
    const current = (existing as any)[key];
    const isEmpty = current === null || current === undefined || current === "";
    if (key === "name") {
      // Keep an admin's name; let a curated upload rename.
      if (curated || !isCurated(existing.source)) {
        if (curated) data.name = value;
      }
      continue;
    }
    if (curated || isEmpty || (incomingSource === "google" && googleOwned.has(key))) data[key] = value;
  }

  if (curated && !isCurated(existing.source)) data.source = incomingSource;
  return data as Prisma.TempleUpdateInput;
}
